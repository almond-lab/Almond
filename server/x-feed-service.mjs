import { createHash, timingSafeEqual } from 'node:crypto';
import { SIGNAL_MARKETS, matchedMarkets } from '../signal-model.mjs';

const TTL = 60_000;
const API = 'https://api.x.com/2/tweets/search/recent';
function reply(status, body, guarded = true) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
function allowedURL(raw, kind) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && (kind === 'avatar' ? u.hostname === 'pbs.twimg.com' : ['pbs.twimg.com', 'video.twimg.com'].includes(u.hostname)) ? u.href : '';
  } catch { return ''; }
}
function count(v) { return Number.isSafeInteger(v) && v >= 0 ? v : null; }

export function normalizeXResponse(raw, market) {
  if (!raw || typeof raw !== 'object' || (raw.data !== undefined && !Array.isArray(raw.data))) throw new Error('invalid_response');
  if (!raw.data && Array.isArray(raw.errors) && raw.errors.length) throw new Error('invalid_response');
  const users = new Map((raw.includes?.users || []).map(u => [u.id, u]));
  const media = new Map((raw.includes?.media || []).map(m => [m.media_key, m]));
  const seen = new Set();
  const posts = [];
  for (const post of (raw.data || []).slice(0, 50)) {
    const author = users.get(post.author_id);
    if (!/^\d{1,25}$/.test(post.id || '') || seen.has(post.id) || !author || !/^[A-Za-z0-9_]{1,15}$/.test(author.username || '') || typeof author.name !== 'string' || post.possibly_sensitive || post.withheld || author.withheld || author.protected) continue;
    // Replies and reposts are already excluded by the search; defend against unexpected results too.
    if ((post.referenced_posts || post.referenced_tweets || []).some(r => ['retweeted', 'replied_to'].includes(r.type))) continue;
    const text = post.note_post?.text ?? post.note_tweet?.text ?? post.text;
    if (typeof text !== 'string' || !text.trim() || text.length > 100_000 || !Number.isFinite(Date.parse(post.created_at))) continue;
    const entities = post.note_post?.entities || post.note_tweet?.entities || post.entities || {};
    const markets = matchedMarkets(text);
    if (market !== 'all' && !markets.includes(market)) markets.push(market);
    if (!markets.length) continue;
    seen.add(post.id);
    const metrics = post.public_metrics || {};
    const images = (post.attachments?.media_keys || []).map(k => media.get(k)).filter(m => m?.type === 'photo' && allowedURL(m.url, 'media')).slice(0, 4).map(m => ({ url: allowedURL(m.url, 'media'), alt: typeof m.alt_text === 'string' ? m.alt_text : 'Image attached to this X post' }));
    posts.push({ id: post.id, text, createdAt: new Date(post.created_at).toISOString(), url: `https://x.com/${author.username}/status/${post.id}`, markets, edited: Array.isArray(post.edit_history_post_ids || post.edit_history_tweet_ids) && (post.edit_history_post_ids || post.edit_history_tweet_ids).length > 1,
      author: { name: author.name, username: author.username, avatar: allowedURL(author.profile_image_url, 'avatar'), url: `https://x.com/${author.username}` },
      entities: { urls: (entities.urls || []).filter(e => typeof e.url === 'string' && /^https:\/\/t\.co\/[A-Za-z0-9]+$/.test(e.url)).slice(0, 100).map(e => ({ url: e.url, display: typeof e.display_url === 'string' ? e.display_url : e.url })) },
      images, hasOtherMedia: (post.attachments?.media_keys || []).some(k => media.get(k)?.type !== 'photo'),
      metrics: { likes: count(metrics.like_count), replies: count(metrics.reply_count), reposts: count(metrics.repost_count ?? metrics.retweet_count) } });
  }
  return { posts, partial: Boolean(raw.errors?.length) };
}

export function feedQuery(market, accounts = '') {
  if (market !== 'all' && !SIGNAL_MARKETS.some(m => m.coin === market)) throw new Error('invalid_market');
  const topic = market === 'all' ? `(${SIGNAL_MARKETS.map(m => m.topic).join(' OR ')})` : SIGNAL_MARKETS.find(m => m.coin === market).topic;
  const handles = accounts.split(',').map(s => s.trim().replace(/^@/, '')).filter(Boolean);
  if (handles.length > 20 || handles.some(h => !/^[A-Za-z0-9_]{1,15}$/.test(h))) throw new Error('invalid_accounts');
  return `${topic}${handles.length ? ` (${handles.map(h => `from:${h}`).join(' OR ')})` : ''} -is:retweet -is:reply lang:en`;
}

export function createXFeedService({ env = process.env, fetcher = globalThis.fetch, now = Date.now } = {}) {
  // Bounded, per-instance caching and request coalescing. Responses bypass CDN/browser caches so only this bounded freshness window applies.
  const cache = new Map();
  return async function handleXFeed(request) {
    if (request.method !== 'GET') return reply(405, { error: 'method_not_allowed', message: 'This feed is read-only. Use GET.' });
    const key = env.X_BEARER_TOKEN?.trim();
    const access = env.X_FEED_ACCESS_TOKEN || '';
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(k => k !== 'market') || params.getAll('market').length > 1) return reply(400, { error: 'invalid_parameters', message: 'Use only one market selector.' });
    const market = params.get('market') || 'all';
    if (market !== 'all' && !SIGNAL_MARKETS.some(m => m.coin === market)) return reply(400, { error: 'invalid_market', message: 'Choose one of Almond’s four markets.' });
    const base = { provider: 'X', market, refreshAfterSeconds: 60, requiresAccessCode: Boolean(access), posts: [] };
    if (!key) return reply(200, { ...base, state: 'setup', note: 'Connect X API recent-search access in Vercel to load real posts. No sample posts are shown.' });
    if (access) {
      const supplied = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
      const digest = v => createHash('sha256').update(v).digest();
      if (!timingSafeEqual(digest(supplied), digest(access))) return reply(401, { ...base, state: 'locked', error: 'access_denied', message: 'Enter the Almond feed access code to load posts. This is not your X API token.' });
    }
    let query;
    try { query = feedQuery(market, env.X_FEED_ACCOUNTS || ''); }
    catch { return reply(503, { ...base, state: 'error', error: 'invalid_configuration', message: 'The server’s X source-account configuration needs correction.' }); }
    let entry = cache.get(market);
    if (entry && now() - entry.at < (entry.status===429?300_000:TTL)) {
      const body = await entry.promise;
      return reply(entry.status, {...body, refreshAfterSeconds:Math.max(1,Math.ceil(((entry.status===429?300_000:TTL)-(now()-entry.at))/1000))}, Boolean(access));
    }
    entry = { at: now(), status: 200 };
    entry.promise = (async () => {
      const url = new URL(API);
      url.searchParams.set('query', query);
      url.searchParams.set('max_results', '50');
      url.searchParams.set('sort_order', 'recency');
      // Current X API field names; old response names are also normalized above.
      url.searchParams.set('post.fields', 'created_at,public_metrics,entities,attachments,possibly_sensitive,withheld,note_post,edit_history_post_ids,referenced_posts');
      url.searchParams.set('expansions', 'author_id,attachments.media_keys');
      url.searchParams.set('user.fields', 'name,username,profile_image_url,protected,withheld');
      url.searchParams.set('media.fields', 'type,url,alt_text');
      try {
        const response = await fetcher(url.href, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000), redirect: 'error' });
        if (!response.ok) {
          entry.status = response.status === 429 ? 429 : 502;
          const denied = [401, 403].includes(response.status);
          return { ...base, state: 'error', error: denied ? 'provider_access' : response.status === 429 ? 'rate_limited' : 'provider_error', message: denied ? 'The server’s X token needs recent-search permission and available API credits.' : response.status === 429 ? 'X has rate limited this feed. Wait five minutes before refreshing.' : 'X could not supply this batch. Try refreshing later.' };
        }
        const normalized = normalizeXResponse(await response.json(), market);
        return { ...base, state: 'live', posts: normalized.posts, fetchedAt: new Date(now()).toISOString(), query, partial: normalized.partial, note: normalized.partial ? 'X returned a partial batch. Topic matches indicate relevance, not a verified price impact.' : 'Recent English-language posts matched to this topic. Checked for new posts every minute; relevance does not establish price impact.' };
      } catch {
        entry.status = 502;
        return { ...base, state: 'error', error: 'provider_unavailable', message: 'The X feed could not be reached or returned an unreadable batch. Refresh later.' };
      }
    })();
    cache.set(market, entry);
    const body = await entry.promise;
    return reply(entry.status, body, Boolean(access));
  };
}
export const handleXFeed = createXFeedService();
