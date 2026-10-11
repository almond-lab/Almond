export const SIGNAL_MARKETS = Object.freeze([
  { coin: 'BTC', name: 'Bitcoin', label: 'BTC / USDC', topic: '(bitcoin OR $BTC OR #Bitcoin)', match: /\bbitcoin\b|\bbtc\b/i },
  { coin: 'xyz:SP500', name: 'S&P 500', label: 'S&P 500 / USDC', topic: '("S&P 500" OR "S&P500" OR SPX OR $SPY)', match: /s&p\s*500|\bspx\b|\bspy\b/i },
  { coin: 'xyz:BRENTOIL', name: 'Brent oil', label: 'BRENT / USDC', topic: '("Brent crude" OR "Brent oil" OR BRENTOIL OR "ICE Brent")', match: /\bbrent\b|\bbrentoil\b/i },
  { coin: 'xyz:GOLD', name: 'Gold', label: 'GOLD / USDC', topic: '("gold futures" OR "gold price" OR XAUUSD OR $XAU OR $GC_F)', match: /\bgold\b|\bxauusd\b|\bxau\b|\bgc_f\b/i },
]);
export const REACTION_KEY = 'almond.pulse.reactions.v1';
export const MAX_REACTIONS = 500;

export function matchedMarkets(text) { return SIGNAL_MARKETS.filter(m => m.match.test(text)).map(m => m.coin); }

export function selectPosts(posts, { market = 'all', filter = 'unread', sort = 'recent', reactions = {}, skipped = new Set() } = {}) {
  return posts.filter(p => (market === 'all' || p.markets.includes(market)) && !skipped.has(p.id) && (filter === 'all' || (filter === 'unread' ? !reactions[p.id] : reactions[p.id]?.decision === filter)))
    .sort((a, b) => (sort === 'popular' ? (b.metrics.likes ?? -1) - (a.metrics.likes ?? -1) : 0) || Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id));
}

export function readReactions(raw) {
  const safe = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return safe;
  const entries = Object.entries(raw).filter(([, e]) => e && typeof e === 'object').sort((a, b) => (Date.parse(a[1].at) || 0) - (Date.parse(b[1].at) || 0));
  for (const [id, entry] of entries) {
    if (!/^\d{1,25}$/.test(id) || !entry || !['agree', 'disagree'].includes(entry.decision) || !Number.isFinite(Date.parse(entry.at))) continue;
    const markets = Array.isArray(entry.markets) ? entry.markets.filter(c => SIGNAL_MARKETS.some(m => m.coin === c)) : [];
    safe[id] = { decision: entry.decision, at: new Date(entry.at).toISOString(), markets, context: SIGNAL_MARKETS.some(m => m.coin === entry.context) ? entry.context : 'all', username: /^[A-Za-z0-9_]{1,15}$/.test(entry.username || '') ? entry.username : '', url: `https://x.com/i/status/${id}` };
  }
  const kept = Object.entries(safe).sort((a, b) => Date.parse(a[1].at) - Date.parse(b[1].at)).slice(-MAX_REACTIONS);
  return Object.fromEntries(kept);
}

export function recordReaction(reactions, post, decision, context, at = new Date().toISOString()) {
  if (!['agree', 'disagree'].includes(decision)) throw new Error('Choose agree or disagree.');
  return readReactions({ ...reactions, [post.id]: { decision, at, context, markets: post.markets, username: post.author.username } });
}

export function reactionCounts(reactions, market = 'all') {
  const entries = Object.values(reactions).filter(r => market === 'all' || r.markets.includes(market));
  return { reviewed: entries.length, agree: entries.filter(r => r.decision === 'agree').length, disagree: entries.filter(r => r.decision === 'disagree').length };
}

export function swipeDecision(dx, dy, width, velocity = 0) {
  if (![dx,dy,width,velocity].every(Number.isFinite) || width<=0) return null;
  const threshold = Math.min(130, Math.max(65, width * .23));
  const flick=Math.abs(dx)>=42 && Math.abs(velocity)>=.55 && Math.sign(velocity)===Math.sign(dx);
  return (Math.abs(dx) >= threshold || flick) && Math.abs(dx) > Math.abs(dy) * 1.25 ? (dx > 0 ? 'agree' : 'disagree') : null;
}
