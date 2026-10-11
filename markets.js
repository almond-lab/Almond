import { MARKETS, STRATEGIES, STALE_BOOK_MS, attributeOrders, bookMetrics, overlayAtPrice, quoteOffset, strategyMetrics, validateConfig } from './market-model.mjs';
import { HyperliquidFeed } from './market-feed.mjs';

const $ = id => document.getElementById(id);
const storageKey = 'almond.hyperliquid.strategies.v1';
let selected = MARKETS[0];
let depth = Number($('depth-count').value);
let ordersScope = 'selected';
let strategyFilter = 'all';
let renderTimer;
const number = (value, digits = 2) => Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '—';
const compact = value => Number.isFinite(value) ? value.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 }) : '—';
const price = value => number(value, value < 1000 ? 3 : 2);
const size = (value, coin) => number(value, feed.available.get(coin)?.decimals ?? MARKETS.find(m => m.coin === coin)?.decimals ?? 5);
const labels = { classical: 'Classical', quantum: 'Quantum' };
const feed = new HyperliquidFeed(() => {
  if (!renderTimer) renderTimer = setTimeout(() => { renderTimer = null; render(); }, 120);
});

function bookState(coin) {
  const entry = feed.books.get(coin);
  const availability = feed.available.get(coin);
  if (availability && !availability.valid) return 'error';
  if (!entry) return 'connecting';
  if (Date.now() - entry.received > STALE_BOOK_MS || Date.now() - entry.book.time > STALE_BOOK_MS) return 'stale';
  if (entry.source !== 'stream' || feed.connection !== 'connected') return 'snapshot';
  return 'live';
}

function allOrders() {
  return [...feed.accounts].flatMap(([wallet, account]) => attributeOrders(wallet, account.orders, feed.config));
}

function activeOrders() {
  return allOrders().filter(order => feed.accountStatus(order.wallet) === 'synced');
}

function badge(strategy) {
  return `<span class="strategy-badge ${strategy}" title="${labels[strategy]} resting quote">${strategy === 'classical' ? 'C' : 'Q'}</span>`;
}

function statusText(id, value) {
  if ($(id).textContent !== value) $(id).textContent = value;
}

function renderBook(book, orders) {
  const metrics = bookMetrics(book, depth);
  $('mid-price').textContent = metrics.mid ? price(metrics.mid) : '—';
  $('spread-value').textContent = metrics.spreadBps !== null ? `${number(metrics.spreadBps)} bps` : '—';
  $('depth-value').textContent = book ? `${compact(metrics.total)} USDC` : '—';
  $('imbalance-value').textContent = metrics.imbalance !== null ? `${metrics.imbalance > 0 ? '+' : ''}${number(metrics.imbalance * 100, 1)}%` : '—';
  const maxSize = Math.max(0, ...[0, 1].flatMap(i => book?.levels[i].slice(0, depth).map(l => l.sz) || []));
  for (const [index, id, side] of [[0, 'bid-rows', 'B'], [1, 'ask-rows', 'A']]) {
    let cumulative = 0;
    const rows = book?.levels[index].slice(0, depth) || [];
    $(id).innerHTML = rows.length ? rows.map(level => {
      cumulative += level.sz;
      const markers = overlayAtPrice(orders, selected.coin, side, level.px).map(badge).join('');
      return `<tr class="book-row ${index ? 'ask' : 'bid'}" style="--depth:${maxSize ? level.sz / maxSize * 100 : 0}%"><td>${price(level.px)}</td><td>${size(level.sz, selected.coin)}</td><td>${size(cumulative, selected.coin)}</td><td>${markers || '<span aria-hidden="true">·</span>'}</td></tr>`;
    }).join('') : '<tr><td colspan="4" class="empty-cell">Waiting for order-book data</td></tr>';
  }
  renderDepth(book, orders);
}

function renderDepth(book, orders) {
  const svg = $('depth-chart');
  const narrow = svg.clientWidth < 500;
  const width = Math.max(300, svg.clientWidth || 800), height = 260;
  const left = narrow ? 54 : 70, right = 20, top = 24, bottom = 43;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.removeAttribute('aria-labelledby');
  const sides = [0, 1].map(i => book?.levels[i].slice(0, depth) || []);
  const levels = sides.flat();
  if (!levels.length) {
    svg.setAttribute('aria-label', `${selected.label} cumulative depth. Waiting for a market snapshot.`);
    svg.innerHTML = `<text x="${width / 2}" y="125" text-anchor="middle" class="chart-empty">Waiting for the live depth snapshot</text>`;
    return;
  }
  let min = Math.min(...levels.map(l => l.px)), max = Math.max(...levels.map(l => l.px));
  const pad = Math.max((max - min) * .08, max * .000001);
  min -= pad; max += pad;
  const totals = sides.map(side => side.reduce((sum, level) => sum + level.px * level.sz, 0));
  const peak = Math.max(1, ...totals) * 1.1;
  const x = value => left + (value - min) / (max - min) * (width - left - right);
  const y = value => height - bottom - value / peak * (height - top - bottom);
  const base = height - bottom;
  let markup = '<desc>Cumulative visible bid and ask notional in USDC. Classical quotes are circles; quantum quotes are diamonds. Only quotes inside the visible price range are marked.</desc>';
  for (let i = 0; i <= 3; i++) {
    const value = peak * i / 3;
    markup += `<line x1="${left}" y1="${y(value)}" x2="${width-right}" y2="${y(value)}" class="depth-grid"/><text x="${left-10}" y="${y(value)+4}" text-anchor="end" class="depth-axis">${compact(value)}</text>`;
  }
  sides.forEach((side, index) => {
    if (!side.length) return;
    let cumulative = 0;
    const points = side.map(l => { cumulative += l.px * l.sz; return [x(l.px), y(cumulative)]; });
    const line = `M${points[0][0]},${base} L` + points.map(p => `${p[0]},${p[1]}`).join(' L');
    const area = `${line} L${points.at(-1)[0]},${base} Z`;
    markup += `<path d="${area}" class="depth-area ${index ? 'ask' : 'bid'}"/><path d="${line}" class="depth-line ${index ? 'ask' : 'bid'}"/>`;
  });
  const ticks = narrow ? 2 : 4;
  for (let i = 0; i <= ticks; i++) {
    const value = min + (max-min) * i/ticks;
    markup += `<text x="${x(value)}" y="${height-14}" text-anchor="${i === 0 ? 'start' : i === ticks ? 'end' : 'middle'}" class="depth-axis">${price(value)}</text>`;
  }
  const mid = bookMetrics(book, depth).mid;
  if (mid) markup += `<line x1="${x(mid)}" y1="${top}" x2="${x(mid)}" y2="${base}" class="depth-mid"/>`;
  let hidden = 0;
  for (const order of orders.filter(o => o.coin === selected.coin)) {
    if (order.px < min || order.px > max) { hidden++; continue; }
    const cx = x(order.px), cy = base - (order.strategy === 'classical' ? 9 : 22);
    const title = `${labels[order.strategy]} ${order.side === 'B' ? 'bid' : 'ask'} ${price(order.px)}, ${size(order.sz, order.coin)} contracts`;
    markup += order.strategy === 'classical' ? `<circle cx="${cx}" cy="${cy}" r="4" class="quote-marker classical"><title>${title}</title></circle>` : `<path d="M${cx},${cy-5} l5,5 l-5,5 l-5,-5Z" class="quote-marker quantum"><title>${title}</title></path>`;
  }
  svg.innerHTML = markup;
  svg.setAttribute('aria-label', `${selected.label} visible cumulative depth, ${depth} levels per side. Bid notional ${number(totals[0])} USDC, ask notional ${number(totals[1])} USDC.`);
  if ($('chart-note')) $('chart-note').textContent = `C = classical · Q = quantum. ${hidden ? `${hidden} quote${hidden === 1 ? '' : 's'} outside this price range; see the order table.` : 'Quote markers show resting order prices, not queue positions.'}`;
}

function renderStrategies(orders) {
  const mid = bookState(selected.coin) === 'live' ? bookMetrics(feed.books.get(selected.coin)?.book).mid : null;
  for (const strategy of STRATEGIES) {
    const status = feed.accountStatus(feed.config[strategy].wallet);
    const metrics = strategyMetrics(orders.filter(o => o.strategy === strategy && o.coin === selected.coin), mid);
    $(`${strategy}-status`).textContent = { unconfigured: 'Add public account', syncing: 'Syncing orders', stale: 'Orders stale', synced: 'Orders synced' }[status];
    $(`${strategy}-status`).dataset.state = status;
    const ready = status === 'synced';
    $(`${strategy}-count`).textContent = ready ? number(metrics.count, 0) : '—';
    $(`${strategy}-notional`).textContent = ready ? `${compact(metrics.notional)} USDC` : '—';
    $(`${strategy}-offset`).textContent = ready && metrics.weightedOffset !== null ? `${number(metrics.weightedOffset)} bps` : '—';
    $(`${strategy}-fills`).textContent = feed.config[strategy].wallet && feed.connection === 'connected' ? number(feed.fillCounts[strategy].get(selected.coin) || 0, 0) : '—';
  }
}

function renderOrders(orders) {
  const filtered = orders.filter(o => (ordersScope === 'all' || o.coin === selected.coin) && (strategyFilter === 'all' || o.strategy === strategyFilter)).sort((a,b) => a.coin.localeCompare(b.coin) || a.strategy.localeCompare(b.strategy) || a.side.localeCompare(b.side) || b.px-a.px);
  $('order-rows').innerHTML = filtered.length ? filtered.map(order => {
    const market = MARKETS.find(m => m.coin === order.coin);
    const stale = feed.accountStatus(order.wallet) !== 'synced';
    const offset = !stale && bookState(order.coin) === 'live' ? quoteOffset(order, bookMetrics(feed.books.get(order.coin)?.book).mid) : null;
    return `<tr class="strategy-order ${order.strategy}${stale ? ' stale-order' : ''}"><td>${badge(order.strategy)} ${labels[order.strategy]}${stale ? ' · stale' : ''}</td><td>${market.label}</td><td class="${order.side === 'B' ? 'bid-text' : 'ask-text'}">${order.side === 'B' ? 'Bid' : 'Ask'}</td><td>${price(order.px)}</td><td>${size(order.sz, order.coin)}</td><td>${number(order.px*order.sz)} USDC</td><td>${offset === null ? '—' : `${number(offset)} bps`}</td><td>${order.postOnly ? 'Post-only' : 'Resting limit'}</td><td>${order.oid}</td></tr>`;
  }).join('') : '<tr><td colspan="9" class="empty-cell">No resting strategy orders to display</td></tr>';
  const configured = STRATEGIES.filter(s => feed.config[s].wallet);
  const stale = configured.some(s => feed.accountStatus(feed.config[s].wallet) === 'stale');
  statusText('orders-message', !configured.length ? 'Add a public strategy account above to see your resting quotes. Market data connects independently.' : stale ? 'One or more order feeds are stale. Cached orders are labelled and excluded from overlays and comparison totals.' : configured.some(s => feed.accountStatus(feed.config[s].wallet) === 'syncing') ? 'Fetching resting limits from both the native and Trade[XYZ] markets…' : `${filtered.length} resting order${filtered.length === 1 ? '' : 's'} in this view. Orders outside the visible depth remain listed here.`);
}

function render() {
  const state = bookState(selected.coin);
  const entry = feed.books.get(selected.coin);
  statusText('feed-status', { live: 'Live order book', connecting: 'Connecting', stale: 'Stale book', snapshot: 'Snapshot · reconnecting', error: 'Market unavailable' }[state]);
  $('feed-status').dataset.state = state;
  if ($('feed-note')) $('feed-note').textContent = state === 'error' ? feed.available.get(selected.coin)?.error || 'Metadata could not be verified.' : feed.error || (state === 'live' ? 'Hyperliquid mainnet · public L2 stream' : state === 'stale' ? 'No fresh book update in 15 seconds. Values below are the last received snapshot.' : state === 'snapshot' ? 'REST snapshot available. Waiting for a fresh WebSocket update.' : 'Connecting to Hyperliquid mainnet…');
  $('last-update').textContent = entry ? `Exchange ${new Date(entry.book.time).toISOString().slice(11,23)} UTC · ${Math.max(0, Math.floor((Date.now()-entry.received)/1000))}s since receipt` : 'Awaiting first snapshot';
  if ($('book-message')) statusText('book-message', state === 'live' ? '' : 'Market statistics reflect the last snapshot. Live quote offsets resume when the stream is fresh.');
  $('market-title').textContent = selected.label;
  $('market-symbol').textContent = `${selected.coin} · ${selected.dex ? 'Trade[XYZ] HIP-3' : 'Hyperliquid native'} · USDC perpetual`;
  for (const button of document.querySelectorAll('[data-market]')) {
    const coin = button.dataset.market;
    button.setAttribute('aria-pressed', String(coin === selected.coin));
    button.classList.toggle('active', coin === selected.coin);
    const available = feed.available.get(coin);
    button.dataset.state = bookState(coin);
    const priceLabel = button.querySelector('[data-market-price]');
    const statusLabel = button.querySelector('[data-market-state]');
    const mid = bookMetrics(feed.books.get(coin)?.book).mid;
    if (priceLabel) priceLabel.textContent = mid ? price(mid) : '—';
    if (statusLabel) statusLabel.textContent = available && !available.valid ? 'Unavailable' : bookState(coin) === 'live' ? 'Live' : bookState(coin) === 'stale' ? 'Stale' : 'Connecting';
  }
  const orders = allOrders();
  renderBook(entry?.book, activeOrders());
  renderStrategies(activeOrders());
  renderOrders(orders);
}

function applyConfig(input, persist) {
  const config = validateConfig(input);
  feed.setConfig(config);
  for (const strategy of STRATEGIES) {
    $(`${strategy}-wallet`).value = config[strategy].wallet;
    $(`${strategy}-prefix`).value = config[strategy].prefix;
  }
  if (persist) {
    try { localStorage.setItem(storageKey, JSON.stringify(config)); }
    catch { $('config-status').textContent = 'Accounts connected for this session. Browser storage is unavailable.'; return; }
  }
  $('config-status').textContent = STRATEGIES.some(s => config[s].wallet) ? 'Public accounts saved on this browser. Syncing resting orders…' : 'No strategy accounts configured. Market data remains live.';
}

$('strategy-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    applyConfig(Object.fromEntries(STRATEGIES.map(s => [s, { wallet: $(`${s}-wallet`).value, prefix: $(`${s}-prefix`).value }])), true);
  } catch (error) { $('config-status').textContent = error.message; }
});
$('clear-wallets').addEventListener('click', () => {
  try { localStorage.removeItem(storageKey); } catch { /* Session-only storage. */ }
  applyConfig({}, false);
  $('config-status').textContent = 'Strategy accounts cleared from this browser.';
});
for (const button of document.querySelectorAll('[data-market]')) button.addEventListener('click', () => {
  selected = MARKETS.find(m => m.coin === button.dataset.market);
  render();
});
$('depth-count').addEventListener('change', event => { depth = Number(event.target.value) === 20 ? 20 : 10; render(); });
$('orders-scope').addEventListener('change', event => { ordersScope = event.target.value; render(); });
$('strategy-filter').addEventListener('change', event => { strategyFilter = event.target.value; render(); });
$('retry-feed').addEventListener('click', async () => {
  $('retry-feed').disabled = true;
  try { await feed.retry(); } finally { $('retry-feed').disabled = false; }
});
$('export-market').addEventListener('click', () => {
  const output = {
    schema: 'almond.hyperliquid.snapshot.v1', exportedAt: new Date().toISOString(), sessionStart: new Date(feed.sessionStart).toISOString(),
    source: 'Hyperliquid mainnet public info API and WebSocket', market: selected, connection: feed.connection, visibleDepth: depth,
    books: MARKETS.map(m => ({ coin: m.coin, state: bookState(m.coin), ...feed.books.get(m.coin) })),
    orders: allOrders().map(o => ({ ...o, accountState: feed.accountStatus(o.wallet), quoteOffsetBps: bookState(o.coin) === 'live' && feed.accountStatus(o.wallet) === 'synced' ? quoteOffset(o, bookMetrics(feed.books.get(o.coin)?.book).mid) : null })),
    strategies: feed.config, makerFillsDuringSession: Object.fromEntries(STRATEGIES.map(s => [s, Object.fromEntries(feed.fillCounts[s])])),
    definitions: { depth: 'Visible L2 levels only; not the full book.', imbalance: '(visible bid notional - visible ask notional) / total visible notional', offsets: 'Notional-weighted passive distance from midpoint in basis points; no offset for stale feeds.', restingOrders: 'Non-trigger limit orders. Post-only marked only if the API exposes tif=Alo.', makerFills: 'Attributed streaming fills with crossed=false since session/configuration start. Historical snapshots are excluded; reconnect gaps may undercount. Shared/tagged accounts include only fills matched to observed client-order IDs.', strategyComparison: 'Observed quote statistics only. Decision latency, net P&L, inventory, and quantum speedup require separate strategy telemetry.' },
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `almond-${selected.coin.replace(':', '-')}-${Date.now()}.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
});
try {
  const stored = localStorage.getItem(storageKey);
  if (stored) applyConfig(JSON.parse(stored), false);
} catch { $('config-status').textContent = 'Saved accounts could not be loaded. Please enter the public addresses again.'; }
render();
feed.start();
window.addEventListener('resize', () => renderDepth(feed.books.get(selected.coin)?.book, activeOrders()));
window.addEventListener('pagehide', () => feed.stop());
window.addEventListener('pageshow', event => { if (event.persisted) feed.start(); });
