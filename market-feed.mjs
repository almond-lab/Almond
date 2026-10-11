import { MARKETS, STRATEGIES, normalizeBook, validateConfig, STALE_ORDERS_MS } from './market-model.mjs';

const INFO = 'https://api.hyperliquid.xyz/info';
const SOCKET = 'wss://api.hyperliquid.xyz/ws';

export class HyperliquidFeed {
  constructor(onChange, { fetcher = globalThis.fetch, Socket = globalThis.WebSocket } = {}) {
    this.onChange = onChange;
    this.fetcher = fetcher.bind(globalThis);
    this.Socket = Socket;
    this.books = new Map();
    this.accounts = new Map();
    this.available = new Map();
    this.config = validateConfig();
    this.connection = 'connecting';
    this.error = '';
    this.generation = 0;
    this.failures = 0;
    this.pendingOrders = false;
    this.closedOrders = new Set();
    this.fillSeen = new Set();
    this.fillCounts = { classical: new Map(), quantum: new Map() };
    this.knownOrders = new Map();
    this.orderMetadata = new Map();
    this.sessionStart = Date.now();
  }

  async info(body) {
    const response = await this.fetcher(INFO, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Hyperliquid returned HTTP ${response.status}`);
    return response.json();
  }

  async start() {
    this.stopped = false;
    this.orderPoll = setInterval(() => this.refreshOrders(), 15_000);
    this.healthTimer = setInterval(() => this.onChange(), 1_000);
    await this.loadMetadata();
    if (!this.stopped) this.connect();
  }

  async loadMetadata() {
    this.connection = 'connecting';
    this.onChange();
    await Promise.all(['', 'xyz'].map(async dex => {
      try {
        const metadata = await this.info({ type: 'meta', dex });
        for (const market of MARKETS.filter(m => m.dex === dex)) {
          const asset = metadata.universe?.find(a => a.name === market.coin && !a.isDelisted);
          this.available.set(market.coin, { valid: Boolean(asset && metadata.collateralToken === 0), decimals: asset?.szDecimals ?? market.decimals, error: asset ? 'USDC collateral could not be verified' : 'Instrument unavailable' });
        }
      } catch {
        for (const market of MARKETS.filter(m => m.dex === dex)) this.available.set(market.coin, { valid: false, decimals: market.decimals, error: 'Market metadata unavailable; retry the feed' });
      }
    }));
    this.onChange();
  }

  subscriptions() {
    const subscriptions = MARKETS.filter(m => this.available.get(m.coin)?.valid).map(m => ({ type: 'l2Book', coin: m.coin }));
    for (const user of new Set(STRATEGIES.map(s => this.config[s].wallet).filter(Boolean))) {
      subscriptions.push({ type: 'orderUpdates', user }, { type: 'userFills', user });
      for (const dex of ['', 'xyz']) subscriptions.push({ type: 'openOrders', user, dex });
    }
    return subscriptions;
  }

  connect() {
    if (this.stopped) return;
    this.connection = 'connecting';
    this.onChange();
    const ws = new this.Socket(SOCKET);
    this.ws = ws;
    this.lastMessage = Date.now();
    const openTimeout = setTimeout(() => { if (this.ws === ws && ws.readyState !== 1) ws.close(); }, 12_000);
    ws.onopen = () => {
      if (this.ws !== ws || this.stopped) return;
      clearTimeout(openTimeout);
      this.connection = 'connected';
      this.error = '';
      for (const subscription of this.subscriptions()) ws.send(JSON.stringify({ method: 'subscribe', subscription }));
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastMessage > 45_000) ws.close();
        else if (ws.readyState === 1) ws.send(JSON.stringify({ method: 'ping' }));
      }, 20_000);
      this.refreshOrders();
      this.onChange();
    };
    ws.onmessage = event => {
      if (this.ws !== ws || this.stopped) return;
      this.lastMessage = Date.now();
      try { this.handleMessage(JSON.parse(event.data)); } catch { /* Ignore malformed transport messages. */ }
    };
    ws.onerror = () => { if (this.ws === ws) this.error = 'The live connection could not be reached.'; };
    ws.onclose = () => {
      clearTimeout(openTimeout);
      if (this.ws !== ws || this.stopped) return;
      clearInterval(this.heartbeat);
      this.connection = 'reconnecting';
      this.onChange();
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.failures++, 5));
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
    // A REST snapshot provides context even when a browser cannot reach WebSockets.
    for (const market of MARKETS.filter(m => this.available.get(m.coin)?.valid)) {
      this.info({ type: 'l2Book', coin: market.coin }).then(raw => this.acceptBook(raw, 'snapshot')).catch(() => {});
    }
  }

  acceptBook(raw, source) {
    if (this.stopped || !this.available.get(raw?.coin)?.valid) return;
    const book = normalizeBook(raw);
    if (!book || book.time < (this.books.get(book.coin)?.book.time || 0)) return;
    if (source === 'snapshot' && this.books.get(book.coin)?.source === 'stream' && book.time <= this.books.get(book.coin).book.time) return;
    this.books.set(book.coin, { book, source, received: Date.now() });
    if (source === 'stream') this.failures = 0;
    this.onChange();
  }

  handleMessage(message) {
    const { channel, data } = message;
    if (channel === 'l2Book') this.acceptBook(data, 'stream');
    if (channel === 'error') { this.error = 'Hyperliquid rejected a subscription. Retry to refresh market metadata.'; this.onChange(); }
    if (channel === 'orderUpdates' && Array.isArray(data)) {
      for (const update of data) {
        if (update.status === 'open') this.closedOrders.delete(update.order?.oid);
        else if (update.order?.oid) this.closedOrders.add(update.order.oid);
      }
      // Terminal events remove quotes immediately; refresh confirms remaining sizes/new orders.
      for (const account of this.accounts.values()) account.orders = account.orders.filter(o => !this.closedOrders.has(o.oid));
      this.scheduleOrders();
      this.onChange();
    }
    if (channel === 'openOrders' && data?.user) this.scheduleOrders();
    if (channel === 'userFills' && data?.user && Array.isArray(data.fills) && !data.isSnapshot) {
      const wallet = data.user.toLowerCase();
      for (const fill of data.fills) {
        if (!Number.isFinite(fill.time) || fill.time < this.sessionStart || fill.crossed !== false || !MARKETS.some(m => m.coin === fill.coin)) continue;
        const key = `${wallet}:${fill.coin}:${fill.time}:${fill.tid}`;
        if (this.fillSeen.has(key)) continue;
        this.fillSeen.add(key);
        for (const strategy of STRATEGIES) {
          const entry = this.config[strategy];
          if (entry.wallet !== wallet) continue;
          // Shared/tagged wallets require known order attribution, never guess a strategy.
          if (entry.prefix && !this.knownOrders.get(`${wallet}:${fill.oid}`)?.startsWith(entry.prefix)) continue;
          const counts = this.fillCounts[strategy];
          counts.set(fill.coin, (counts.get(fill.coin) || 0) + 1);
        }
      }
      this.onChange();
    }
  }

  scheduleOrders() {
    if (this.orderRefreshTimer) return;
    this.orderRefreshTimer = setTimeout(() => { this.orderRefreshTimer = null; this.refreshOrders(); }, 750);
  }

  async enrichOrders(user, rawOrders) {
    // Client IDs and time-in-force are immutable but not always in frontendOpenOrders.
    // Query the public order-status endpoint once per order, in bounded batches.
    const relevant = rawOrders.filter(order => MARKETS.some(m => m.coin === order.coin) && order.orderType === 'Limit' && order.isTrigger === false);
    const pending = relevant.filter(order => !this.orderMetadata.has(`${user}:${order.oid}`)).slice(0, 24);
    for (let i = 0; i < pending.length; i += 8) {
      await Promise.all(pending.slice(i, i + 8).map(async order => {
        try {
          const result = await this.info({ type: 'orderStatus', user, oid: order.oid });
          const details = result.status === 'order' ? result.order?.order : null;
          if (details?.oid === order.oid) {
            const metadata = {};
            if (details.cloid !== undefined) metadata.cloid = details.cloid;
            if (details.tif !== undefined) metadata.tif = details.tif;
            this.orderMetadata.set(`${user}:${order.oid}`, metadata);
            if (result.order.status && result.order.status !== 'open') this.closedOrders.add(order.oid);
          }
        } catch { /* Keep a resting-limit label until post-only/attribution metadata is known. */ }
      }));
    }
    return rawOrders.map(order => ({ ...order, ...this.orderMetadata.get(`${user}:${order.oid}`) }));
  }

  async refreshOrders() {
    if (this.stopped) return;
    if (this.pendingOrders) { this.scheduleOrders(); return; }
    this.pendingOrders = true;
    const generation = this.generation;
    try {
      const wallets = [...new Set(STRATEGIES.map(s => this.config[s].wallet).filter(Boolean))];
      await Promise.all(wallets.map(async user => {
        try {
          const results = await Promise.all(['', 'xyz'].map(dex => this.info({ type: 'frontendOpenOrders', user, dex })));
          if (this.stopped || this.generation !== generation) return;
          if (results.some(result => !Array.isArray(result))) throw new Error('Invalid order snapshot');
          const enriched = await this.enrichOrders(user, results.flat());
          if (this.stopped || this.generation !== generation) return;
          const orders = enriched.filter(order => !this.closedOrders.has(order.oid));
          for (const order of orders) if (typeof order.cloid === 'string') this.knownOrders.set(`${user}:${order.oid}`, order.cloid.toLowerCase());
          this.accounts.set(user, { orders, received: Date.now(), error: '' });
        } catch {
          if (this.stopped || this.generation !== generation) return;
          const old = this.accounts.get(user);
          this.accounts.set(user, { orders: old?.orders || [], received: old?.received || 0, error: 'Order refresh failed' });
        }
      }));
    } finally {
      this.pendingOrders = false;
      this.onChange();
    }
  }

  setConfig(input) {
    const next = validateConfig(input);
    const previousSubscriptions = this.subscriptions().filter(s => s.type !== 'l2Book');
    this.generation++;
    this.config = next;
    this.accounts.clear();
    this.closedOrders.clear();
    this.knownOrders.clear();
    this.fillSeen.clear();
    this.fillCounts = { classical: new Map(), quantum: new Map() };
    this.sessionStart = Date.now();
    const walletSubscriptions = this.subscriptions().filter(s => s.type !== 'l2Book');
    if (this.ws?.readyState === 1) {
      for (const subscription of previousSubscriptions) this.ws.send(JSON.stringify({ method: 'unsubscribe', subscription }));
      for (const subscription of walletSubscriptions) this.ws.send(JSON.stringify({ method: 'subscribe', subscription }));
    }
    this.refreshOrders();
    this.onChange();
  }

  accountStatus(wallet, now = Date.now()) {
    if (!wallet) return 'unconfigured';
    const account = this.accounts.get(wallet);
    if (!account) return 'syncing';
    if (account.error || now - account.received > STALE_ORDERS_MS) return 'stale';
    return 'synced';
  }

  async retry() {
    clearTimeout(this.reconnectTimer);
    clearInterval(this.heartbeat);
    if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null; }
    this.failures = 0;
    await this.loadMetadata();
    if (!this.stopped) this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.orderRefreshTimer);
    clearInterval(this.orderPoll);
    clearInterval(this.healthTimer);
    clearInterval(this.heartbeat);
    if (this.ws) { this.ws.onclose = null; this.ws.close(); }
  }
}
