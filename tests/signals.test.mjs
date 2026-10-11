import test from 'node:test';
import assert from 'node:assert/strict';
import { createXFeedService, feedQuery, normalizeXResponse } from '../server/x-feed-service.mjs';
import { matchedMarkets, selectPosts, recordReaction, readReactions, reactionCounts, swipeDecision } from '../signal-model.mjs';

const raw = () => ({ data: [
  { id: '1900000000000000001', author_id: '11', created_at: '2026-10-11T01:00:00Z', text: 'Bitcoin and gold price. https://t.co/test1', entities: { urls: [{ url: 'https://t.co/test1', display_url: 'example.org' }] }, public_metrics: { like_count: 3, reply_count: 2, retweet_count: 1 } },
  { id: '1900000000000000002', author_id: '11', created_at: '2026-10-11T02:00:00Z', text: 'Brent crude: research.', public_metrics: { like_count: 20 } },
], includes: { users: [{ id: '11', username: 'test_only', name: 'QA Fixture', profile_image_url: 'https://pbs.twimg.com/profile_images/test.jpg' }] } });
const request = (market = 'all', auth = '') => new Request(`https://almond.test/api/x-feed?market=${encodeURIComponent(market)}`, { headers: auth ? { Authorization: `Bearer ${auth}` } : {} });

test('X setup never invents posts, exposes secrets, or calls a provider', async () => {
  let calls = 0;
  const handler = createXFeedService({ env: {}, fetcher: () => { calls++; } });
  const response = await handler(request());
  assert.equal(response.status, 200); const body = await response.json();
  assert.equal(body.state, 'setup'); assert.deepEqual(body.posts, []); assert.equal(calls, 0);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('X endpoint restricts markets and methods before any billable query', async () => {
  let calls = 0;
  const handler = createXFeedService({ env: { X_BEARER_TOKEN: 'test-only-secret' }, fetcher: () => { calls++; } });
  assert.equal((await handler(request('arbitrary search'))).status, 400);
  assert.equal((await handler(new Request('https://almond.test/api/x-feed?market=BTC&random=123'))).status, 400);
  assert.equal((await handler(new Request('https://almond.test/api/x-feed', { method: 'POST' }))).status, 405);
  assert.equal(calls, 0);
  assert.throws(() => feedQuery('malicious'));
  assert.throws(() => feedQuery('BTC', 'account OR scam'));
  assert(feedQuery('BTC', '@test_only,other').includes('(from:test_only OR from:other)'));
});

test('optional feed access guard authenticates before provider reads and avoids shared caching', async () => {
  let calls = 0;
  const handler = createXFeedService({ env: { X_BEARER_TOKEN: 'test-only-secret', X_FEED_ACCESS_TOKEN: 'private-fixture' }, fetcher: async () => { calls++; return Response.json(raw()); } });
  const denied = await handler(request()); assert.equal(denied.status, 401); assert.equal(calls, 0);
  const response = await handler(request('all', 'private-fixture'));
  assert.equal(response.status, 200); assert.equal(calls, 1); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert(!(await response.text()).includes('test-only-secret'));
});

test('bounded live search caches/coalesces concurrent reads and expires after five minutes', async () => {
  let clock = Date.parse('2026-10-11T02:00:00Z'), calls = 0;
  const handler = createXFeedService({ env: { X_BEARER_TOKEN: 'test-only-secret' }, now: () => clock, fetcher: async (url, options) => {
    calls++; const u = new URL(url);
    assert.equal(u.origin, 'https://api.x.com'); assert.equal(u.pathname, '/2/tweets/search/recent');
    assert.equal(u.searchParams.get('max_results'), '50'); assert.equal(u.searchParams.get('sort_order'), 'recency');
    assert(u.searchParams.get('post.fields').includes('note_post')); assert(u.searchParams.get('query').includes('-is:retweet'));
    assert.equal(options.headers.Authorization, 'Bearer test-only-secret'); assert.equal(options.redirect, 'error');
    await new Promise(resolve => setTimeout(resolve, 5)); return Response.json(raw());
  } });
  const [a,b] = await Promise.all([handler(request()), handler(request())]);
  assert.equal(calls, 1); const body = await a.json(); assert.equal(body.state, 'live'); assert.equal(body.posts.length, 2);
  assert.equal(b.headers.get('cache-control'), 'public, max-age=0, s-maxage=300');
  await handler(request()); assert.equal(calls, 1);
  clock += 300_001; await handler(request()); assert.equal(calls, 2);
});

test('normalization preserves full note text, timestamps, source links and safe author/media URLs', () => {
  const fixture = raw(); fixture.data[0].note_post = { text: 'Bitcoin: complete note text with emoji 🥜', entities: {} };
  fixture.data[0].attachments = { media_keys: ['safe', 'bad'] }; fixture.includes.media = [{ media_key: 'safe', type: 'photo', url: 'https://pbs.twimg.com/media/test.jpg', alt_text: 'Test image' }, { media_key: 'bad', type: 'photo', url: 'http://localhost/private' }];
  fixture.data.push(fixture.data[0]);
  const result = normalizeXResponse(fixture, 'all');
  assert.equal(result.posts.length, 2); assert.equal(result.posts[0].text, fixture.data[0].note_post.text);
  assert.equal(result.posts[0].images.length, 1); assert.equal(result.posts[0].images[0].alt, 'Test image');
  assert.equal(result.posts[0].url, 'https://x.com/test_only/status/1900000000000000001');
  assert.deepEqual(result.posts[0].markets, ['BTC']); assert.equal(result.posts[1].metrics.likes, 20);
});

test('normalization excludes replies, reposts, sensitive/withheld and malformed posts', () => {
  const fixture = raw(); fixture.data[0].referenced_posts = [{ type: 'retweeted' }]; fixture.data[1].possibly_sensitive = true;
  assert.deepEqual(normalizeXResponse(fixture, 'all').posts, []);
  const protectedFixture = raw(); protectedFixture.includes.users[0].protected = true;
  assert.deepEqual(normalizeXResponse(protectedFixture, 'all').posts, []);
  assert.throws(() => normalizeXResponse({ data: {} }, 'all'));
});

test('provider errors are sanitized and cached, without stale posts or secret error bodies', async () => {
  for (const status of [401,403,429,500]) {
    let calls = 0;
    const handler = createXFeedService({ env: { X_BEARER_TOKEN: 'test-only-secret' }, fetcher: async () => { calls++; return Response.json({ detail: 'test-only-secret sensitive account' }, { status }); } });
    const response = await handler(request()); assert.equal(response.status, status === 429 ? 429 : 502);
    const body = await response.json(); assert.deepEqual(body.posts, []); assert(!JSON.stringify(body).includes('test-only-secret')); assert.equal(body.state, 'error');
    await handler(request()); assert.equal(calls, 1);
  }
});

test('topic classification and batch sorting distinguish personal opinions from X metrics', () => {
  assert.deepEqual(matchedMarkets('S&P500, Brent crude, XAUUSD and Bitcoin'), ['BTC','xyz:SP500','xyz:BRENTOIL','xyz:GOLD']);
  const posts = normalizeXResponse(raw(), 'all').posts;
  const reactions = recordReaction({}, posts[0], 'agree', 'BTC');
  assert.equal(selectPosts(posts, { reactions }).length, 1);
  assert.equal(selectPosts(posts, { sort: 'popular', filter: 'all' })[0].id, posts[1].id);
  assert.equal(selectPosts(posts, { market: 'xyz:GOLD', filter: 'agree', reactions })[0].id, posts[0].id);
  assert.deepEqual(reactionCounts(reactions, 'BTC'), { reviewed: 1, agree: 1, disagree: 0 });
  const changed = recordReaction(reactions, posts[0], 'disagree', 'all');
  assert.deepEqual(reactionCounts(changed), { reviewed: 1, agree: 0, disagree: 1 });
  assert.equal(changed[posts[0].id].url, `https://x.com/i/status/${posts[0].id}`);
});

test('reaction restore rejects forged links, invalid dates/choices and unbounded storage', () => {
  const safe = readReactions({ bad: { decision: 'agree', at: new Date().toISOString() }, '123': { decision: 'agree', at: '2026-10-11', markets: ['BTC', 'other'], username: 'x', url: 'javascript:alert(1)' }, '456': { decision: 'disagree', at: 'bad' } });
  assert.deepEqual(Object.keys(safe), ['123']); assert.equal(safe['123'].url, 'https://x.com/i/status/123'); assert.deepEqual(safe['123'].markets, ['BTC']);
  const huge = Object.fromEntries(Array.from({length:700}, (_,i) => [String(i+1), { decision:'agree', at:'2026-10-11', markets:['BTC'] }]));
  assert.equal(Object.keys(readReactions(huge)).length,500);
});

test('swipes require deliberate horizontal travel and tolerate vertical scrolling', () => {
  assert.equal(swipeDecision(130, 15, 500), 'agree');
  assert.equal(swipeDecision(-95, 5, 350), 'disagree');
  assert.equal(swipeDecision(15, 5, 350), null); assert.equal(swipeDecision(100, 180, 350), null);
  assert.equal(swipeDecision(150, 140, 350), null);
});

test('a deliberate fast flick can commit while jitter, reversed release and vertical reading cannot',()=>{
  assert.equal(swipeDecision(48,4,500,.8),'agree');
  assert.equal(swipeDecision(-48,4,500,-.8),'disagree');
  assert.equal(swipeDecision(20,1,500,3),null);
  assert.equal(swipeDecision(48,2,500,-.8),null);
  assert.equal(swipeDecision(48,70,500,.8),null);
  assert.equal(swipeDecision(NaN,0,500,1),null);
  assert.equal(swipeDecision(100,0,0,1),null);
});
