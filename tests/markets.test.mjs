import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, normalizeBook, bookMetrics, attributeOrders, normalizeOrder, quoteOffset, overlayAtPrice, strategyMetrics } from '../market-model.mjs';
import { HyperliquidFeed } from '../market-feed.mjs';

const walletA = '0x' + 'a'.repeat(40), walletB = '0x' + 'b'.repeat(40);
const config = validateConfig({ classical: { wallet: walletA }, quantum: { wallet: walletB } });
const order = { coin: 'BTC', side: 'B', limitPx: '99', sz: '2', oid: 123, timestamp: 1, isTrigger: false, orderType: 'Limit', cloid: '0xc1000000000000000000000000000001' };

test('accounts and non-overlapping shared-account client IDs prevent double attribution', () => {
  assert.throws(() => validateConfig({ classical: { wallet: 'not-an-address' } }));
  assert.throws(() => validateConfig({ classical: { wallet: walletA }, quantum: { wallet: walletA } }));
  assert.throws(() => validateConfig({ classical: { wallet: walletA, prefix: '0xc' }, quantum: { wallet: walletA, prefix: '0xc1' } }));
  const shared = validateConfig({ classical: { wallet: walletA, prefix: '0xc1' }, quantum: { wallet: walletA, prefix: '0xa1' } });
  assert.deepEqual(attributeOrders(walletA, [order], shared).map(o => o.strategy), ['classical']);
  assert.equal(attributeOrders(walletA, [{ ...order, cloid: null }], shared).length, 0);
  assert.equal(attributeOrders(walletB, [order], config)[0].strategy, 'quantum');
});

test('book normalization rejects invalid levels, sorts sides, merges price levels and handles one-sided books', () => {
  const book = normalizeBook({ coin: 'BTC', time: 1, levels: [[{ px: '98', sz: '1' }, { px: '99', sz: '2' }, { px: '99', sz: '3' }, { px: '-1', sz: '4' }], [{ px: '102', sz: '2' }, { px: '101', sz: '1' }]] });
  assert.deepEqual(book.levels[0].map(l => [l.px, l.sz]), [[99,5],[98,1]]);
  const metrics = bookMetrics(book, 1);
  assert.equal(metrics.mid, 100);
  assert.equal(metrics.spreadBps, 200);
  assert.equal(metrics.total, 596);
  assert.equal(metrics.imbalance, (495-101)/596);
  assert.equal(bookMetrics({ levels: [[], [{ px: 101, sz: 1 }]] }).mid, null);
  assert.equal(normalizeBook({ coin: 'unrelated', time: 1, levels: [[],[]] }), null);
});

test('quotes exclude triggers and unknown types, preserve verified post-only and calculate weighted offsets', () => {
  assert.equal(normalizeOrder({ ...order, isTrigger: true }), null);
  assert.equal(normalizeOrder({ ...order, orderType: 'Market' }), null);
  assert.equal(normalizeOrder({ ...order, sz: '0' }), null);
  assert.equal(normalizeOrder(order).postOnly, false);
  assert.equal(normalizeOrder({ ...order, tif: 'Alo' }).postOnly, true);
  const orders = attributeOrders(walletA, [order, { ...order, side: 'A', limitPx: '101', sz: '1', oid: 124 }], config);
  assert.equal(quoteOffset(orders[0], 100), 100);
  assert.equal(quoteOffset({ side: 'B', px: 101 }, 100), -100);
  assert.deepEqual(overlayAtPrice(orders, 'BTC', 'B', 99), ['classical']);
  assert.deepEqual(strategyMetrics(orders, 100), { count: 2, notional: 299, weightedOffset: 100 });
});

test('maker fill observations deduplicate events, exclude history/takers and respect known client IDs', () => {
  const feed = new HyperliquidFeed(() => {});
  feed.config = validateConfig({ classical: { wallet: walletA, prefix: '0xc1' }, quantum: { wallet: walletA, prefix: '0xa1' } });
  feed.sessionStart = 10;
  feed.knownOrders.set(`${walletA}:123`, order.cloid);
  const fill = { coin: 'BTC', oid: 123, crossed: false, time: 20, tid: 99 };
  feed.handleMessage({ channel: 'userFills', data: { user: walletA, isSnapshot: true, fills: [fill] } });
  assert.equal(feed.fillCounts.classical.size, 0);
  const data = { user: walletA, fills: [fill, fill, { ...fill, tid: 100, crossed: true }, { ...fill, tid: 101, time: 1 }, { ...fill, tid: 102, oid: 999 }] };
  feed.handleMessage({ channel: 'userFills', data });
  feed.handleMessage({ channel: 'userFills', data });
  assert.equal(feed.fillCounts.classical.get('BTC'), 1);
  assert.equal(feed.fillCounts.quantum.size, 0);
  feed.stop();
});

test('terminal order updates remove quotes before REST reconciliation; stale data is identified', () => {
  const feed = new HyperliquidFeed(() => {});
  feed.accounts.set(walletA, { orders: [order], received: Date.now(), error: '' });
  assert.equal(feed.accountStatus(walletA), 'synced');
  feed.handleMessage({ channel: 'orderUpdates', data: [{ order, status: 'filled' }] });
  assert.equal(feed.accounts.get(walletA).orders.length, 0);
  feed.accounts.get(walletA).received = Date.now() - 36_000;
  assert.equal(feed.accountStatus(walletA), 'stale');
  feed.stop();
});

test('enriched order status supports tagged accounts and rejects responses after configuration changes', async () => {
  let resolveOrders;
  const wait = new Promise(resolve => resolveOrders = resolve);
  const feed = new HyperliquidFeed(() => {}, { fetcher: async (_, options) => {
    const body = JSON.parse(options.body);
    if (body.type === 'frontendOpenOrders') await wait;
    return { ok: true, json: async () => body.type === 'orderStatus' ? { status: 'order', order: { order: { ...order, tif: 'Alo' } } } : body.dex ? [] : [order] };
  } });
  feed.config = config;
  const pending = feed.refreshOrders();
  feed.config = validateConfig();
  feed.generation++;
  resolveOrders();
  await pending;
  assert.equal(feed.accounts.size, 0);
  const enriched = await feed.enrichOrders(walletA, [{ ...order, cloid: undefined }]);
  assert.equal(enriched[0].cloid, order.cloid);
  assert.equal(enriched[0].tif, 'Alo');
  feed.stop();
});

test('older REST snapshots cannot overwrite newer streamed books', () => {
  const feed = new HyperliquidFeed(() => {});
  feed.available.set('BTC', { valid: true });
  feed.acceptBook({ coin: 'BTC', time: 200, levels: [[{ px: '99', sz: '1' }],[{ px: '101', sz: '1' }]] }, 'stream');
  feed.acceptBook({ coin: 'BTC', time: 100, levels: [[{ px: '1', sz: '1' }],[]] }, 'snapshot');
  assert.equal(feed.books.get('BTC').book.time, 200);
  assert.equal(feed.books.get('BTC').source, 'stream');
  feed.stop();
});
