import { SIGNAL_MARKETS, readReactions, recordReaction, selectPosts, reactionCounts, swipeDecision, readDismissed, mergePostBatches } from './signal-model.mjs';
import { PortfolioController } from './portfolio-controller.mjs';

// Older agreement reactions are not reinterpreted as directional price views.
const DISMISSED_KEY = 'qswipe.feed.dismissed.v1';
const REACTION_KEY = 'almond.pulse.directional-reactions.v2';
export const portfolio = new PortfolioController();

const $ = id => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let market = 'all', posts = [], current = null, reactions = {}, history = [], skipped = new Set(), seen = new Set();
let busy = false, loading = false, generation = 0, fetchGeneration = 0, controller, autoTimer, expiryTimer, dataState = 'loading', fetchedAt = null, pointer = null;
let lastStateNote = 'Connecting to the X feed…';
try { reactions = readReactions(JSON.parse(localStorage.getItem(REACTION_KEY) || '{}')); } catch { /* Continue without stored reactions. */ }

try { const saved=readDismissed(JSON.parse(localStorage.getItem(DISMISSED_KEY)||'null'));seen=new Set(saved.seen);skipped=new Set(saved.skipped); } catch {}
function saveDismissed(){try{const saved=readDismissed({seen:[...seen],skipped:[...skipped]});localStorage.setItem(DISMISSED_KEY,JSON.stringify(saved));}catch{}}

function el(tag, cls, text) { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; }
function link(text, url, cls) { const a = el('a', cls, text); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; }
function message(text) { $('reaction-message').textContent = text; }
function marketName(coin) { return SIGNAL_MARKETS.find(m => m.coin === coin)?.name || 'All markets'; }
function dateText(raw) { return new Date(raw).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
function isStale() { return fetchedAt && Date.now() - Date.parse(fetchedAt) > 15 * 60_000; }

function appendPostText(node, post) {
  const knownURLs = new Map(post.entities.urls.map(e => [e.url, e.display]));
  const pattern = /https?:\/\/[^\s<>]+|@[A-Za-z0-9_]{1,15}\b|#[\p{L}\p{N}_]+/gu;
  let end = 0;
  for (const token of post.text.matchAll(pattern)) {
    node.append(document.createTextNode(post.text.slice(end, token.index)));
    const value = token[0];
    if (value.startsWith('@') && !/[\w@]/.test(post.text[token.index - 1] || '')) node.append(link(value, `https://x.com/${value.slice(1)}`));
    else if (value.startsWith('#')) node.append(link(value, `https://x.com/search?q=${encodeURIComponent(value)}`));
    else if (value.startsWith('http')) node.append(link(knownURLs.get(value) || value, value));
    else node.append(document.createTextNode(value));
    end = token.index + value.length;
  }
  node.append(document.createTextNode(post.text.slice(end)));
}

function card(post) {
  const article = el('article', 'pulse-card');
  article.tabIndex = 0;
  article.setAttribute('aria-label', `X post by ${post.author.name}. Use right arrow to Agree or left arrow to Disagree.`);
  article.setAttribute('aria-describedby', 'keyboard-hint');
  const kicker = el('div', 'card-kicker');
  kicker.append(el('span', '', `MARKET CONVERSATION / ${post.markets.map(marketName).join(' · ')}`));
  const x = el('span', 'x-mark');
  x.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" role="img" aria-label="X"><path fill="currentColor" d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.3l7.3-8.5L.8 2h6.5l4.5 6.8L18.9 2Zm-1.1 18h1.7L6.4 3.9H4.6L17.8 20Z"/></svg>';
  kicker.append(x);
  const author = el('div', 'card-author');
  const avatarLink = link('', post.author.url, 'author-avatar');
  avatarLink.setAttribute('aria-label', `${post.author.name}'s X profile`);
  if (post.author.avatar) {
    const img = el('img'); img.src = post.author.avatar; img.alt = ''; img.width = 48; img.height = 48; img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => { avatarLink.replaceChildren(document.createTextNode(post.author.name.slice(0, 1))); });
    avatarLink.append(img);
  } else avatarLink.textContent = post.author.name.slice(0, 1);
  const identity = el('div', 'author-identity');
  identity.append(link(post.author.name, post.author.url, 'author-name'), link(`@${post.author.username}`, post.author.url, 'author-handle'));
  author.append(avatarLink, identity);
  const body = el('p', 'card-text'); appendPostText(body, post);
  body.tabIndex = 0; body.setAttribute('role', 'region'); body.setAttribute('aria-label', 'Scrollable full post text');
  const source = el('div', 'card-source');
  const time = el('time', 'card-time', dateText(post.createdAt)); time.dateTime = post.createdAt;
  const timeLink = link('', post.url); timeLink.append(time); source.append(timeLink, link('View on X ↗', post.url));
  if (post.edited) source.append(el('span', 'edited-note', 'Edited · view current version on X'));
  article.append(kicker, author, body);
  if (post.images.length) {
    const images = el('div', 'card-images');
    for (const item of post.images) { const a = link('', post.url); const img = el('img'); img.src = item.url; img.alt = item.alt; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; a.append(img); images.append(a); }
    article.append(images);
  }
  if (post.hasOtherMedia) article.append(link('Watch attached media on X ↗', post.url, 'media-link'));
  article.append(source);
  const metrics = el('div', 'card-metrics');
  const fmt = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
  for (const [key, label] of [['likes', 'X likes'], ['replies', 'Replies'], ['reposts', 'Reposts']]) if (Number.isFinite(post.metrics[key])) metrics.append(el('span', '', `${fmt.format(post.metrics[key])} ${label}`));
  article.append(metrics);
  const tags = el('div', 'card-tags');
  for (const coin of post.markets) tags.append(el('span', '', SIGNAL_MARKETS.find(m => m.coin === coin)?.label));
  if (reactions[post.id]) tags.append(el('span', 'your-reaction', `Your takeaway: ${reactions[post.id].decision === 'agree' ? 'Agree' : 'Disagree'}`));
  article.append(tags);
  // Swipe affordances are separate Almond feedback; they do not invoke X actions.
  article.append(el('span', 'swipe-stamp agree-stamp', 'AGREE'), el('span', 'swipe-stamp disagree-stamp', 'DISAGREE'));
  article.addEventListener('pointerdown', beginDrag);
  article.addEventListener('pointermove', moveDrag);
  article.addEventListener('pointerup', endDrag);
  article.addEventListener('pointercancel', cancelDrag);
  article.addEventListener('lostpointercapture', cancelDrag);
  article.addEventListener('click', event => {
    if (article.dataset.suppressClick === 'true') { event.preventDefault(); event.stopPropagation(); }
  });
  return article;
}

function updateControls() {
  const disabled = !current || busy || isStale();
  for (const id of ['agree-button', 'disagree-button', 'skip-button']) $(id).disabled = disabled;
  $('undo-button').disabled = !history.length || busy;
  $('export-reactions').disabled = !Object.keys(reactions).length;
  if ($('clear-reactions')) $('clear-reactions').disabled = !Object.keys(reactions).length || busy;
  $('refresh-feed').disabled = loading;
  document.querySelectorAll('[data-feed-retry]').forEach(button=>button.disabled=loading);
  if ($('connect-feed')) $('connect-feed').disabled = loading;
}

function renderJournal() {
  const counts = reactionCounts(reactions, market);
  $('reviewed-count').textContent = counts.reviewed;
  $('agree-count').textContent = counts.agree;
  $('disagree-count').textContent = counts.disagree;
  const list = $('saved-list'); list.replaceChildren();
  const rows = Object.entries(reactions).filter(([, r]) => market === 'all' || r.markets.includes(market)).sort((a, b) => Date.parse(b[1].at) - Date.parse(a[1].at)).slice(0, 12);
  if (!rows.length) { list.append(el('p', 'journal-empty', 'Your perspective starts here. React to a post to save your takeaway.')); return; }
  for (const [id, r] of rows) {
    const row = el('div', `saved-item ${r.decision}`);
    const detail = el('div', 'saved-detail');
    detail.append(link(r.username ? `@${r.username}` : `Post ${id}`, r.url), el('small', '', `${r.markets.map(marketName).join(' · ')} / ${dateText(r.at)}`));
    row.append(el('span', 'saved-direction', r.decision === 'agree' ? '↗' : '↙'), detail, el('span', 'saved-decision', r.decision === 'agree' ? 'Agree' : 'Disagree'));
    list.append(row);
  }
}

function renderDeck(preferredId) {
  generation++;
  pointer = null;
  busy = false;
  const focused = document.activeElement?.classList.contains('pulse-card');
  const candidates = selectPosts(posts, { market, filter: $('review-filter').value, sort: $('feed-sort').value, reactions, skipped });
  current = isStale() ? null : candidates.find(p => p.id === preferredId) || candidates.find(p => !seen.has(p.id)) || null;
  portfolio.setPost(current);
  document.querySelector('.backcard-one').style.transform='';
  const deck = $('deck'); deck.replaceChildren();
  $('market-label').textContent = marketName(market);
  if ($('filter-label')) $('filter-label').textContent = `${candidates.filter(p => !seen.has(p.id)).length} posts in this view`;
  if (current) {
    deck.append(card(current));
    if (focused) deck.firstElementChild.focus({ preventScroll: true });
  } else {
    const empty = el('div', 'deck-empty'); empty.id = 'deck-empty';
    empty.append(el('span', 'empty-kicker', dataState === 'live' ? 'YOUR PERSPECTIVE, AT YOUR PACE' : 'REAL POSTS / REAL SOURCES'));
    const symbol = el('div', 'empty-symbol'); symbol.setAttribute('aria-hidden', 'true'); symbol.append(el('span', '', '↖'), el('span', '', '↗')); empty.append(symbol);
    const title = isStale() ? 'Time for a fresh read.' : dataState === 'loading' ? 'Finding the conversation.' : dataState === 'setup' ? 'Your feed is next.' : dataState === 'locked' ? 'Connect your private feed.' : dataState === 'error' ? 'The feed needs a moment.' : candidates.length || posts.length ? 'You’re through this view.' : 'A quiet moment.';
    empty.append(el('h3', '', title), el('p', '', isStale() ? 'This batch is more than 15 minutes old. Refresh the feed before recording another directional view.' : dataState === 'live' ? 'Refresh for the latest batch, choose another market, or revisit your reviewed posts.' : lastStateNote), el('span', 'empty-footer', dataState === 'setup' ? 'No sample posts. Waiting for the source.' : 'One perspective at a time.'));
    if (isStale() || dataState === 'error' || dataState === 'live') { const retry=el('button','secondary-button',dataState==='error'?'Try the feed again ↻':'Check for new posts ↻');retry.type='button';retry.dataset.feedRetry='true';retry.disabled=loading;retry.addEventListener('click',()=>loadFeed({prioritizeNew:true}));empty.append(retry); }
    if (!isStale() && dataState === 'live' && posts.some(post=>market==='all'||post.markets.includes(market))) { const again = el('button', 'secondary-button', 'Revisit this view ↻'); again.type = 'button'; again.addEventListener('click', () => { seen.clear(); skipped.clear(); saveDismissed(); renderDeck(); }); empty.append(again); }
    deck.append(empty);
  }
  renderJournal(); updateControls();
}

function save() {
  try { localStorage.setItem(REACTION_KEY, JSON.stringify(reactions)); }
  catch { message('Reaction saved for this visit. Browser storage is unavailable.'); return false; }
  return true;
}

async function react(decision) {
  if (!current || busy || isStale()) return;
  const coin = portfolio.chooseAsset(current);
  if (!coin) { message('Choose the affected asset for your 24-hour directional view.'); cancelDrag(); renderDeck(current.id); return; }
  const post = current, token = generation;
  busy = true; updateControls();
  const article = $('deck').querySelector('.pulse-card');
  article?.classList.add(decision === 'agree' ? 'is-agreeing' : 'is-disagreeing');
  if (article && !reducedMotion.matches) {
    const direction = decision === 'agree' ? 1 : -1;
    article.style.animation='none';
    await article.animate([{ transform: getComputedStyle(article).transform, opacity: 1 }, { transform: `translate3d(${direction * Math.min(innerWidth, 760)}px,-25px,0) rotate(${direction * 17}deg)`, opacity: 0 }], { duration: 210, easing: 'cubic-bezier(.24,.72,.32,1)', fill: 'forwards' }).finished.catch(() => {});
  }
  if (token !== generation) return;
  const eventId = portfolio.record(post, decision === 'agree' ? 1 : -1, coin);
  history.push({ id: post.id, previous: reactions[post.id] || null, type: 'reaction', eventId }); history = history.slice(-100);
  reactions = recordReaction(reactions, { ...post, markets: [coin] }, decision, coin);
  seen.add(post.id); saveDismissed();
  const stored = save();
  message(`${decision === 'agree' ? 'Agree' : 'Disagree'} opinion for ${marketName(coin)} recorded for the next 24 hours${stored ? ' in this browser.' : ' for this visit; browser storage is unavailable.'}`);
  renderDeck();
}

function beginDrag(event) {
  if (busy || !current || isStale() || !event.isPrimary || event.button !== 0 || event.target.closest('a')) return;
  const article = event.currentTarget;
  article.style.animation='none';
  pointer = { id:event.pointerId,x:event.clientX,y:event.clientY,lastX:event.clientX,lastTime:event.timeStamp,velocity:0,raf:0,dx:0,dy:0,article,horizontal:false,vertical:false };
  article.dataset.suppressClick = 'false';
}
function moveDrag(event) {
  if (!pointer || pointer.id !== event.pointerId) return;
  const dt=Math.max(1,event.timeStamp-pointer.lastTime);pointer.velocity=.35*pointer.velocity+.65*(event.clientX-pointer.lastX)/dt;pointer.lastX=event.clientX;pointer.lastTime=event.timeStamp;
  pointer.dx = event.clientX - pointer.x; pointer.dy = event.clientY - pointer.y;
  if (!pointer.horizontal && !pointer.vertical) {
    if (Math.abs(pointer.dx) > 12 && Math.abs(pointer.dx) > Math.abs(pointer.dy) * 1.25) { pointer.horizontal = true; pointer.article.setPointerCapture(event.pointerId); }
    else if (Math.abs(pointer.dy) > 12) pointer.vertical = true;
  }
  if (!pointer.horizontal) return;
  event.preventDefault();
  pointer.article.dataset.suppressClick = 'true';
  pointer.article.classList.add('is-dragging');
  if(!pointer.raf){const p=pointer;p.raf=requestAnimationFrame(()=>{p.raf=0;if(pointer!==p)return;p.article.style.transform=`translate3d(${p.dx}px,${Math.min(12,Math.abs(p.dx)*.035)}px,0) rotate(${p.dx/30}deg)`;const confidence=Math.min(1,Math.abs(p.dx)/95);p.article.style.setProperty('--agree-opacity',p.dx>0?confidence:0);p.article.style.setProperty('--disagree-opacity',p.dx<0?confidence:0);document.querySelector('.backcard-one').style.transform=`translateY(${7-confidence*4}px) rotate(${-2+confidence}deg) scale(${1+confidence*.01})`;});}
}
function cancelDrag(event) {
  if (!pointer) return;
  // Touch starts with implicit capture on a child; transferring it to the card
  // produces a bubbled loss event from that child, not a canceled gesture.
  if (event?.type === 'lostpointercapture' && (event.target !== pointer.article || pointer.article.hasPointerCapture(pointer.id))) return;
  const { article,raf } = pointer;cancelAnimationFrame(raf);pointer = null;
  springBack(article);
  setTimeout(() => { article.dataset.suppressClick = 'false'; }, 200);
}
function endDrag(event) {
  if (!pointer || pointer.id !== event.pointerId) return;
  const p = pointer;
  const velocity=event.timeStamp-p.lastTime>100?0:p.velocity;
  const decision = p.horizontal ? swipeDecision(p.dx, p.dy, p.article.offsetWidth,velocity) : null;
  cancelAnimationFrame(p.raf);pointer = null;
  if (p.article.hasPointerCapture(event.pointerId)) p.article.releasePointerCapture(event.pointerId);
  if (decision) { react(decision); return; }
  springBack(p.article);
  setTimeout(() => { p.article.dataset.suppressClick = 'false'; }, 200);
}

function springBack(article){
  const start=getComputedStyle(article).transform;
  article.classList.remove('is-dragging');article.style.transform='';article.style.removeProperty('--agree-opacity');article.style.removeProperty('--disagree-opacity');document.querySelector('.backcard-one').style.transform='';
  if(!reducedMotion.matches&&start!=='none')article.animate([{transform:start},{transform:'translate3d(0,0,0) rotate(0deg)',offset:.72},{transform:'translate3d(0,0,0) rotate(0deg)'}],{duration:310,easing:'cubic-bezier(.16,1.3,.28,1)'});
}

function updateMarketLinks() {
  const m = SIGNAL_MARKETS.find(m => m.coin === market);
  $('venue-link').href = `https://app.hyperliquid.xyz/trade/${m?.coin || 'BTC'}`;
  $('venue-link').textContent = `Open ${m?.name || 'BTC'} on Hyperliquid ↗`;
  $('search-x').href = `https://x.com/search?q=${encodeURIComponent(m?.topic || SIGNAL_MARKETS.map(item => item.topic).join(' OR '))}&f=live`;
}

async function loadFeed({ prioritizeNew = false } = {}) {
  const token = ++fetchGeneration;
  controller?.abort(); controller = new AbortController(); clearTimeout(autoTimer); clearTimeout(expiryTimer);
  loading = true; dataState = 'loading'; lastStateNote = 'Fetching a recent batch from X…';
  $('feed-status').textContent = 'Updating the conversation'; $('feed-status').dataset.state = 'loading';
  if (!posts.length) renderDeck(); else updateControls();
  try {
    const access = $('feed-access').value.trim();
    const response = await fetch(`/api/x-feed?market=${encodeURIComponent(market)}`, { headers: access ? { Authorization: `Bearer ${access}` } : {}, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
    const result = await response.json();
    if (token !== fetchGeneration) return;
    if (!response.ok) { const error = new Error(result.message || 'This feed could not be loaded.'); error.state = result.state; throw error; }
    dataState = result.state; lastStateNote = result.note;
    const incoming=Array.isArray(result.posts)?result.posts:[],known=new Set(posts.map(p=>p.id));
    const newCount=incoming.filter(p=>!known.has(p.id)&&!seen.has(p.id)&&!skipped.has(p.id)&&!reactions[p.id]).length;
    const hadBatch=posts.length>0 || seen.size>0 || skipped.size>0;
    posts = mergePostBatches(posts,incoming); fetchedAt = result.fetchedAt || null;
    if (fetchedAt) expiryTimer=setTimeout(()=>{if(!isStale())return;$('feed-status').textContent='Feed refresh required';$('feed-status').dataset.state='stale';message('Refresh the feed to continue: these posts are more than 15 minutes old.');renderDeck();},Math.max(0,Date.parse(fetchedAt)+15*60_000-Date.now()+1));
    $('feed-status').textContent = result.state === 'live' ? 'Recent X posts connected' : 'X connection required';
    $('feed-status').dataset.state = result.state;
    $('feed-note').textContent = lastStateNote;
    $('source-time').textContent = fetchedAt ? dateText(fetchedAt) : 'Awaiting connection';
    $('source-time').dateTime = fetchedAt || '';
    const oldId = current?.id;
    const newestUnseen=prioritizeNew?selectPosts(incoming,{market,filter:$('review-filter').value,reactions,skipped}).find(post=>!seen.has(post.id))?.id:undefined;
    renderDeck(prioritizeNew?newestUnseen:oldId);
    if(result.state==='live' && hadBatch){const note=newCount?`${newCount} new unseen post${newCount===1?'':'s'} available.`:'No new unseen posts in the latest X batch. Checking again shortly.';$('feed-note').textContent=note;message(note);}
    if (result.state === 'live') autoTimer = setTimeout(() => { if (document.visibilityState === 'visible') loadFeed(); }, Math.max(5,Math.min(300,result.refreshAfterSeconds ?? 60))*1000);
  } catch (error) {
    if (token !== fetchGeneration) return;
    dataState = error.state || 'error'; lastStateNote = error.name === 'AbortError' ? 'The feed refresh was interrupted.' : error.message;
    if (dataState === 'locked') document.querySelector('.feed-setup details').open = true;
    $('feed-status').textContent = dataState === 'locked' ? 'Feed access code required' : 'Feed update unavailable';
    $('feed-status').dataset.state = dataState; $('feed-note').textContent = lastStateNote;
    // Do not present previously loaded posts as fresh after a failed refresh.
    posts = []; current = null; fetchedAt = null; $('source-time').textContent = 'Update unavailable';
    renderDeck();
  } finally { if (token === fetchGeneration) { loading = false; updateControls(); } }
}

$('agree-button').addEventListener('click', () => react('agree'));
$('disagree-button').addEventListener('click', () => react('disagree'));
$('skip-button').addEventListener('click', () => { if (!current || busy) return; const id = current.id; skipped.add(id); saveDismissed(); history.push({ id, type: 'skip' }); message('Skipped in this browser. No reaction recorded.'); renderDeck(); });
$('undo-button').addEventListener('click', () => {
  if (busy || !history.length) return;
  const last = history.pop(); seen.delete(last.id); skipped.delete(last.id); saveDismissed();
  if (last.type === 'reaction') { if (last.previous) reactions[last.id] = last.previous; else delete reactions[last.id]; portfolio.undo(last.eventId); save(); }
  message('Last action undone.'); renderDeck(last.id);
});
for (const button of document.querySelectorAll('[data-signal-market]')) button.addEventListener('click', () => {
  if (button.dataset.signalMarket === market) return;
  market = button.dataset.signalMarket; posts = []; current = null; fetchedAt = null;
  for (const b of document.querySelectorAll('[data-signal-market]')) { b.setAttribute('aria-pressed', String(b === button)); b.classList.toggle('active', b === button); }
  updateMarketLinks(); loadFeed();
});
for (const id of ['review-filter', 'feed-sort']) $(id).addEventListener('change', () => { renderDeck(); });
$('refresh-feed').addEventListener('click', () => loadFeed({prioritizeNew:true}));
if ($('connect-feed')) $('connect-feed').addEventListener('click', loadFeed);
$('feed-access').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); loadFeed(); } });
$('export-reactions').addEventListener('click', () => {
  const output = { schema: 'almond.market-pulse.directional-views.v2', exportedAt: new Date().toISOString(), scope: 'Private 24-hour directional preferences in this browser. Not X likes, expected returns, or strategy results.', reactions };
  const url = URL.createObjectURL(new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' }));
  const a = el('a'); a.href = url; a.download = 'almond-market-pulse-reactions.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
});
if ($('clear-reactions')) $('clear-reactions').addEventListener('click', () => { reactions = {}; history = []; seen.clear(); skipped.clear(); saveDismissed(); portfolio.clear(); save(); message('Opinions cleared. Your paper positions are held.'); renderDeck(); });
document.addEventListener('keydown', event => {
  if (document.body.dataset.view && document.body.dataset.view !== 'swipe') return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.target.closest('input,select,textarea,button,a,[contenteditable]')) return;
  if (event.key === 'ArrowRight') { event.preventDefault(); react('agree'); }
  else if (event.key === 'ArrowLeft') { event.preventDefault(); react('disagree'); }
  else if (event.key.toLowerCase() === 'z') $('undo-button').click();
  else if (event.key.toLowerCase() === 's') $('skip-button').click();
});
window.addEventListener('storage', event => {
  if (event.key !== REACTION_KEY) return;
  try { reactions = readReactions(JSON.parse(event.newValue || '{}')); history = []; renderDeck(current?.id); } catch { /* Ignore invalid external storage. */ }
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && dataState === 'live' && Date.now() - Date.parse(fetchedAt) >= 60_000) loadFeed(); });
window.addEventListener('pagehide', () => { clearTimeout(autoTimer); clearTimeout(expiryTimer); controller?.abort(); $('feed-access').value = ''; });
window.addEventListener('pageshow', event => { if (event.persisted) loadFeed(); });
updateMarketLinks(); renderJournal(); loadFeed();
