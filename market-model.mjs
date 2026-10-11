export const MARKETS = Object.freeze([
  { coin: 'BTC', label: 'BTC/USDC', name: 'Bitcoin', dex: '', decimals: 5 },
  { coin: 'xyz:SP500', label: 'S&P500/USDC', name: 'S&P 500', dex: 'xyz', decimals: 3 },
  { coin: 'xyz:BRENTOIL', label: 'BRENTOIL/USDC', name: 'Brent oil', dex: 'xyz', decimals: 2 },
  { coin: 'xyz:GOLD', label: 'GOLD/USDC', name: 'Gold', dex: 'xyz', decimals: 4 },
]);
export const STRATEGIES = ['classical', 'quantum'];
export const STALE_BOOK_MS = 15_000;
export const STALE_ORDERS_MS = 35_000;

export function validateConfig(input = {}) {
  const config = {};
  for (const name of STRATEGIES) {
    const wallet = String(input[name]?.wallet || '').trim().toLowerCase();
    const prefix = String(input[name]?.prefix || '').trim().toLowerCase();
    if (wallet && !/^0x[0-9a-f]{40}$/.test(wallet)) throw new Error(`${name}: enter a public 0x address with 40 hexadecimal characters.`);
    if (prefix && !/^0x[0-9a-f]{1,32}$/.test(prefix)) throw new Error(`${name}: the client-order prefix must be 0x followed by 1–32 hexadecimal characters.`);
    if (prefix && !wallet) throw new Error(`${name}: a client-order prefix needs an account address.`);
    config[name] = { wallet, prefix };
  }
  const a = config.classical, b = config.quantum;
  if (a.wallet && a.wallet === b.wallet && (!a.prefix || !b.prefix || a.prefix.startsWith(b.prefix) || b.prefix.startsWith(a.prefix))) {
    throw new Error('A shared account needs two distinct, non-overlapping client-order ID prefixes. Separate subaccounts also work.');
  }
  return config;
}

export function normalizeBook(raw) {
  if (!MARKETS.some(m => m.coin === raw?.coin) || !Array.isArray(raw.levels) || raw.levels.length !== 2 || !Number.isFinite(raw.time)) return null;
  const levels = raw.levels.map((side, index) => {
    if (!Array.isArray(side)) return [];
    const merged = new Map();
    for (const level of side) {
      const px = Number(level.px), sz = Number(level.sz);
      if (!Number.isFinite(px) || px <= 0 || !Number.isFinite(sz) || sz <= 0) continue;
      const current = merged.get(px) || { px, sz: 0, n: 0 };
      current.sz += sz;
      current.n += Number.isFinite(Number(level.n)) ? Number(level.n) : 0;
      merged.set(px, current);
    }
    return [...merged.values()].sort((a, b) => index ? a.px - b.px : b.px - a.px).slice(0, 20);
  });
  return { coin: raw.coin, time: raw.time, levels };
}

export function bookMetrics(book, depth = 20) {
  const bids = book?.levels[0].slice(0, depth) || [], asks = book?.levels[1].slice(0, depth) || [];
  const mid = bids.length && asks.length && asks[0].px >= bids[0].px ? (bids[0].px + asks[0].px) / 2 : null;
  const spread = mid ? asks[0].px - bids[0].px : null;
  const bidNotional = bids.reduce((total, level) => total + level.px * level.sz, 0);
  const askNotional = asks.reduce((total, level) => total + level.px * level.sz, 0);
  const total = bidNotional + askNotional;
  return { mid, spread, spreadBps: mid ? spread / mid * 10_000 : null, bidNotional, askNotional, total, imbalance: total ? (bidNotional - askNotional) / total : null };
}

export function normalizeOrder(raw) {
  const px = Number(raw?.limitPx), sz = Number(raw?.sz);
  // Only the enriched read endpoint confirms these are resting limits, not triggers.
  if (!MARKETS.some(m => m.coin === raw?.coin) || raw.isTrigger !== false || raw.orderType !== 'Limit' || !['A', 'B'].includes(raw.side) || !Number.isFinite(px) || px <= 0 || !Number.isFinite(sz) || sz <= 0 || !Number.isSafeInteger(raw.oid)) return null;
  return { coin: raw.coin, side: raw.side, px, sz, oid: raw.oid, cloid: typeof raw.cloid === 'string' ? raw.cloid.toLowerCase() : null, timestamp: raw.timestamp, postOnly: raw.tif === 'Alo' };
}

export function attributeOrders(wallet, rawOrders, config) {
  return rawOrders.map(normalizeOrder).filter(Boolean).flatMap(order => STRATEGIES.filter(strategy => {
    const entry = config[strategy];
    return entry.wallet === wallet.toLowerCase() && (!entry.prefix || order.cloid?.startsWith(entry.prefix));
  }).map(strategy => ({ ...order, strategy, wallet: wallet.toLowerCase() })));
}

export function quoteOffset(order, mid) {
  // Positive is passive distance from mid; negative means beyond mid toward crossing.
  return mid ? (order.side === 'B' ? mid - order.px : order.px - mid) / mid * 10_000 : null;
}

export function overlayAtPrice(orders, coin, side, px) {
  return STRATEGIES.filter(strategy => orders.some(o => o.strategy === strategy && o.coin === coin && o.side === side && o.px === px));
}

export function strategyMetrics(orders, mid) {
  const notional = orders.reduce((sum, order) => sum + order.px * order.sz, 0);
  const weightedOffset = notional && mid ? orders.reduce((sum, order) => sum + quoteOffset(order, mid) * order.px * order.sz, 0) / notional : null;
  return { count: orders.length, notional, weightedOffset };
}
