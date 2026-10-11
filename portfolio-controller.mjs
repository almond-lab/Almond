import { COINS, DEFAULTS, conviction, makeSnapshot, buildObjective, evaluateChoices, financeMetrics, buildIonQCircuit } from './portfolio-model.mjs';
import { PortfolioMarket } from './portfolio-market.mjs';
import { newPaperAccount, restorePaperAccount, accountMetrics, planPaperRebalance } from './paper-account.mjs';

const KEY = 'almond.portfolio.session.v1';
const names = ['BTC', 'S&P 500', 'Brent', 'Gold'];
const $ = id => document.getElementById(id);
const money = v => Number.isFinite(v) ? new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(v) : '—';
const number = v => Number.isFinite(v) ? v.toFixed(4) : '—';
const side = c => c > 0 ? 'Long' : c < 0 ? 'Short' : 'Flat';
const pct = v => Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : '—';
const loadings = [[.015,.004,0],[.006,.009,0],[.003,.002,.018],[-.002,.005,.003]];
export const RISK_PRIOR = loadings.map((a, i) => loadings.map((b, j) => a.reduce((s, v, k) => s + v * b[k], 0) + (i === j ? [.000625,.000025,.000144,.000049][i] : 0)));

function download(name, value) { const u = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 10_000); }
function cell(row, text, tag = 'td') { const n = document.createElement(tag); n.textContent = text; row.append(n); return n; }
function validEvent(e) { return e && typeof e.id === 'string' && COINS.includes(e.coin) && [1,-1].includes(e.direction) && typeof e.thesis === 'string' && e.thesis.length <= 100 && Number.isFinite(e.at) && e.at <= Date.now() + 60_000; }

export class PortfolioController {
  constructor() {
    this.events = []; this.pending = new Set(); this.version = 0; this.account = newPaperAccount(); this.runs = []; this.angles = null; this.running = false; this.latest = null; this.changedCoin = null;
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved?.schema === 1) {
        this.events = Array.isArray(saved.events) ? saved.events.filter(validEvent).slice(-500) : [];
        this.pending = new Set((saved.pending || []).filter(id => this.events.some(e => e.id === id)));
        this.version = Number.isSafeInteger(saved.version) && saved.version >= 0 ? saved.version : 0;
        this.account = restorePaperAccount(saved.account);
        if (Array.isArray(saved.angles) && saved.angles.length === 4 && saved.angles.every(Number.isFinite)) this.angles = saved.angles;
      }
    } catch { /* Start an isolated paper account if storage is unavailable. */ }
    this.mount();
    this.market = new PortfolioMarket(() => { this.renderAccount(); this.updateAvailability(); this.tryAuto(); });
    this.worker = new Worker(new URL('./qaoa-worker.mjs', import.meta.url), { type: 'module' });
    this.worker.onmessage = e => this.receive(e.data);
    this.worker.onerror = () => { this.running = false; this.status('Local simulation failed. Current paper positions are held.'); this.updateAvailability(); };
    this.market.start();
    this.decayTimer = setInterval(() => this.renderConvictions(), 30_000);
    window.addEventListener('pagehide', () => { this.market.stop(); clearInterval(this.decayTimer); this.worker.terminate(); });
    window.addEventListener('pageshow', e => { if (e.persisted) location.reload(); });
    window.addEventListener('storage', e => {
      if (e.key !== KEY) return;
      this.invalidatedByOtherTab = true; this.version++; this.pendingPlan = null;
      this.status('The paper account or beliefs changed in another tab. Reload this page before optimizing or applying a proposal.'); this.updateAvailability();
    });
    this.renderConvictions(); this.renderAccount(); this.renderResult(); this.updateAvailability();
  }
  mount() {
    const aside = document.querySelector('.reaction-journal');
    const journal = document.createElement('details'); journal.className = 'directional-history';
    const summary = document.createElement('summary'); summary.textContent = 'Directional view history'; journal.append(summary);
    while (aside.firstChild) journal.append(aside.firstChild);
    aside.innerHTML = `<div class="journal-heading"><p class="eyebrow">ONE JOINT PAPER PORTFOLIO</p><h2>Four instruments.<br>One allocation.</h2><span class="private-tag">PAPER ONLY · No wallets or real orders</span></div>
      <dl class="paper-metrics"><div><dt>Paper equity</dt><dd id="paper-equity">$10,000.00</dd></div><div><dt>Gross exposure / cap</dt><dd id="paper-gross">0% / 80%</dd></div><div><dt>Unrealized P&amp;L</dt><dd id="paper-unrealized">—</dd></div><div><dt>Realized / fees</dt><dd id="paper-realized">—</dd></div></dl>
      <p id="portfolio-market-status" class="portfolio-note" role="status">Connecting all four market inputs…</p>
      <p class="eyebrow">YOUR 24-HOUR CONVICTIONS</p><div id="conviction-rows" class="conviction-rows"></div>
      <div class="optimize-bar"><button id="optimize-now" class="button button-primary" type="button">Optimize now ↗</button><span id="swipe-cadence">0 / 10 directional swipes</span></div>
      <p id="optimization-status" class="portfolio-note" role="status">Ten new directional swipes trigger one local QAOA run. Skips do not count.</p>
      <p class="portfolio-note">24 h horizon · 24 h evidence half-life · tanh saturation · evidence cap 1 per asset/thesis. These are signed preferences, not profit probabilities.</p>
      <section class="joint-proposal" aria-labelledby="joint-proposal-title"><h3 id="joint-proposal-title">Joint proposal</h3><p id="proposal-state">No local circuit has run yet.</p><table class="allocation-table"><caption class="sr-only">QAOA proposal and exact classical reference across all four instruments</caption><thead><tr><th scope="col">Asset</th><th scope="col">QAOA</th><th scope="col">Exact</th></tr></thead><tbody id="allocation-rows"></tbody></table><p id="proposal-gap" class="portfolio-note">The exact solver independently checks all 81 portfolios.</p><button id="apply-proposal" class="secondary-button" type="button" disabled>Review QAOA paper rebalance</button><button id="review-classical" class="text-button" type="button" disabled>Review exact reference · classical</button></section>
      <section id="paper-confirm" hidden><h3>Confirm paper rebalance</h3><p id="paper-confirm-note"></p><div id="paper-legs"></div><button id="confirm-paper" class="button button-primary" type="button">Apply to paper account</button><button id="cancel-paper" class="text-button" type="button">Cancel</button></section>
      <a class="text-button" href="#quantum-lab">Inspect the circuit and run evidence ↓</a><p class="portfolio-note">Each non-flat choice targets a 20% slot of post-cost paper equity, rounded down to lot precision. Gross cap 80%; conservative 1× margin model. Fees are modeled at 5 bp. No leverage escalation or auto-paper mode.</p>
      <details><summary>Paper positions and ledger</summary><div id="paper-positions"></div><p id="paper-margin" class="portfolio-note"></p><p class="portfolio-note">Funding is estimated in the objective. This first local paper ledger does not settle funding; displayed P&amp;L excludes funding. XYZ symbols are USDC perpetual contracts, not shares or physical commodities.</p><div id="paper-ledger"></div></details>`;
    aside.append(journal);
    const lab = document.createElement('section'); lab.className = 'quantum-lab'; lab.id = 'quantum-lab';
    lab.innerHTML = `<div class="lab-heading"><div><p class="eyebrow">INSPECT THE COMPUTATION</p><h2>Your views change the objective.<br>The circuit proposes a portfolio.</h2></div><span class="mode-label">LOCAL CLASSICAL STATE-VECTOR SIMULATION</span></div>
      <div class="lab-grid"><section><h3>Changed terms → changed gates</h3><p id="coefficient-note" class="portfolio-note">Individual RZ terms update with beliefs. Pairwise risk interactions stay unchanged during a belief-only edit.</p><div id="circuit-terms"></div><p id="angle-state" role="status">Angles: waiting for the first run.</p><pre id="circuit-angles" tabindex="0" role="region" aria-label="Scrollable circuit angles">γ₀, β₀, γ₁, β₁</pre></section><section><h3>Run evidence</h3><dl id="run-metrics" class="paper-metrics"></dl><p id="run-version" class="portfolio-note">Every run freezes beliefs, reference prices, covariance, holdings and constraints.</p><p id="old-new-cost" class="portfolio-note"></p><p id="cost-breakdown" class="portfolio-note"></p></section></div>
      <h3>Actually sampled portfolio combinations</h3><div class="sample-table-scroll" tabindex="0" role="region" aria-label="Scrollable sampled portfolios"><table class="sample-table"><caption class="sr-only">Sampled combinations, frequencies, feasibility and updated objective</caption><thead><tr><th scope="col">BTC / S&amp;P / Brent / Gold</th><th scope="col">Count</th><th scope="col">Frequency</th><th scope="col">Cost</th><th scope="col">Valid</th></tr></thead><tbody id="sample-rows"></tbody></table></div>
      <div class="lab-actions"><button id="export-optimization" class="secondary-button" type="button" disabled>Export frozen run ↓</button><button id="export-qollab" class="secondary-button" type="button" disabled>Export one-off Qollab input ↓</button><a class="secondary-button" href="/qollab/main.py" download>Download Qollab Python ↓</a></div>
      <details><summary>Model, risk prior and execution modes</summary><p class="portfolio-note">The 8-qubit, two-layer QAOA uses an exact local state vector to retune four angles within 48 evaluations, then draws 1,024 samples. The CPU selects the lowest-cost feasible combination actually sampled. No candidate means hold; the classical reference is never silently substituted.</p><p class="portfolio-note">Belief mismatch = mean((choice − conviction)²); joint risk = 0.25 × wᵀΣw / 0.01; execution friction = 10 × turnover × (modeled fee + half-spread + slippage); funding = signed weights × hourly funding estimate × 24. All objective terms are dimensionless. Convictions are not expected returns.</p><p class="portfolio-note">Σ is a disclosed daily covariance prior built as B Bᵀ + diagonal idiosyncratic variance, not measured correlations. Risk scales by horizon / 24. The reference prices are current exchange marks; simulated buys fill asks and sells fill bids. A fixed 50 bp distance-from-mid fill limit, metadata checks and stale-input guards apply before every paper confirmation.</p><pre id="risk-matrix" tabindex="0" role="region" aria-label="Scrollable covariance prior"></pre><p class="portfolio-note">Encoding per asset (long bit, short bit): 00 flat, 10 long, 01 short, 11 invalid. Displayed bit strings use q0 at the left. Slots never grow with swipes.</p><p class="portfolio-note">Repeated runs stay local. Qollab exports freeze one snapshot and one set of angles for exactly one backend.run call per Run; newer swipes do not launch hardware jobs. The separate <a href="/quantum.html">IonQ connector</a> is a manually submitted provider run, not the local loop. Eight qubits establish no computational speedup.</p><p class="portfolio-note">Research context: <a href="https://github.com/openai/math/tree/main/preprints/QAOA-attains-the-SK-ground-state-energy-in-the-thermodynamic-first-limit-September-25-2026" target="_blank" rel="noopener noreferrer">OpenAI’s SK/QAOA result</a> motivates studying QAOA’s expressive power. This standard QAOA demo does not implement that proof’s compiler or inherit its guarantees for financial portfolios.</p></details>`;
    document.querySelector('.pulse-workspace').after(lab);
    $('risk-matrix').textContent = JSON.stringify({ label: 'Daily modeled covariance prior; not measured', B: loadings, idiosyncraticVariance: [.000625,.000025,.000144,.000049], covariance: RISK_PRIOR }, null, 2);
    const view = document.createElement('div'); view.className = 'directional-selection';
    view.innerHTML = `<label for="view-asset">Your view over the next 24 hours<select id="view-asset"><option value="">Choose the affected asset</option></select></label><label for="view-thesis">Thesis group<select id="view-thesis"><option value="general-outlook">General outlook</option><option value="growth-demand">Growth / demand</option><option value="rates-dollar">Rates / dollar</option><option value="supply-positioning">Supply / positioning</option><option value="liquidity-technical">Liquidity / technical</option></select></label><p class="portfolio-note">Repeated views in the same asset/thesis group have capped influence. A multi-asset post requires your explicit asset choice.</p>`;
    document.querySelector('.reaction-heading').before(view);
    $('optimize-now').addEventListener('click', () => this.optimize('manual'));
    $('apply-proposal').addEventListener('click', () => this.review('qaoa'));
    $('review-classical').addEventListener('click', () => this.review('classical'));
    $('confirm-paper').addEventListener('click', () => this.apply());
    $('cancel-paper').addEventListener('click', () => { this.pendingPlan = null; $('paper-confirm').hidden = true; });
    $('export-optimization').addEventListener('click', () => this.exportRun(false));
    $('export-qollab').addEventListener('click', () => this.exportRun(true));
  }
  save() {
    try { localStorage.setItem(KEY, JSON.stringify({ schema:1, version:this.version, events:this.events, pending:[...this.pending], account:this.account, angles:this.angles })); }
    catch { this.status('This browser cannot save the paper session. Current views and positions remain in memory only.'); }
  }
  status(text) { $('optimization-status').textContent = text; }
  chooseAsset(post) {
    const valid = $('view-asset').value;
    return post.markets.includes(valid) ? valid : null;
  }
  setPost(post) {
    const select = $('view-asset'), previous = select.value;
    select.replaceChildren(); const blank = document.createElement('option'); blank.value = ''; blank.textContent = 'Choose the affected asset'; select.append(blank);
    for (const coin of post?.markets || []) { const o = document.createElement('option'); o.value = coin; o.textContent = names[COINS.indexOf(coin)]; select.append(o); }
    select.value = post?.markets.length === 1 ? post.markets[0] : post?.markets.includes(previous) ? previous : '';
    // Never carry an implicit selection from a single-asset post into a multi-asset post.
    if (post?.markets.length > 1 && this.postId !== post.id) select.value = '';
    this.postId = post?.id;
  }
  record(post, direction, coin) {
    const event = { id:crypto.randomUUID(), coin, direction, thesis:$('view-thesis').value, at:Date.now(), postId:post.id };
    this.events.push(event); this.events = this.events.slice(-500); this.pending.add(event.id); this.version++; this.changedCoin = coin; this.pendingPlan = null;
    if(this.latest || this.running)this.status('Convictions and individual cost terms updated. The earlier snapshot is historical; its paper proposal cannot be applied.');
    this.renderConvictions(); this.renderResult(); this.save(); this.tryAuto();
    return event.id;
  }
  undo(id) {
    if (!this.events.some(e => e.id === id)) return;
    this.changedCoin = this.events.find(e => e.id === id).coin;
    this.events = this.events.filter(e => e.id !== id); this.pending.delete(id); this.version++; this.pendingPlan = null;
    this.renderConvictions(); this.renderResult(); this.save(); this.status('Original directional event removed. Any older proposal is historical.');
  }
  clear() { this.events=[]; this.pending.clear(); this.version++; this.pendingPlan=null; this.renderConvictions(); this.renderResult(); this.save(); }
  fresh() {
    const values = this.market?.values() || [];
    if (values.length !== 4 || values.some(m => !m.valid || !Number.isFinite(m.bookTime) || !Number.isFinite(m.contextTime) || m.bookTime>Date.now()+10_000 || m.contextTime>Date.now()+10_000 || !Number.isFinite(m.mark) || m.mark <= 0 || !Number.isFinite(m.oracle) || m.oracle <= 0 || !Number.isFinite(m.funding) || Date.now()-m.bookTime>15_000 || Date.now()-m.contextTime>60_000 || !m.bids.length || !m.asks.length || m.asks[0].px < m.bids[0].px)) throw new Error('Optimization is paused until all four instruments have fresh books and verified reference inputs. Current positions are held.');
    return values;
  }
  snapshot() {
    const values = this.fresh(), now = Date.now(), metrics = accountMetrics(this.account, values.map(m=>m.mark));
    return makeSnapshot({ id:crypto.randomUUID(), version:this.version, createdAt:now, convictions:conviction(this.events,now), prices:values.map(m=>m.mark), covariance:RISK_PRIOR, covarianceLabel:'Explicit daily model prior; no measured correlation claim', holdings:this.account.positions.map(p=>p.qty), equity:metrics.equity, fundingRates:values.map(m=>m.funding), settings:DEFAULTS, executionRates:values.map(m=>({feeRate:.0005,spreadBps:(m.asks[0].px-m.bids[0].px)/((m.asks[0].px+m.bids[0].px)/2)*10_000,slippageBps:1})), marketInputs:values, accountRevision:this.account.revision });
  }
  tryAuto() { if (this.pending.size>=10 && !this.running && !this.invalidatedByOtherTab) { try { this.fresh(); this.optimize('ten swipes'); } catch { this.updateAvailability(); } } }
  optimize(trigger) {
    if (this.running || this.invalidatedByOtherTab) return;
    let snapshot; try { snapshot=this.snapshot(); } catch(e) { this.status(e.message); return; }
    const seed=crypto.getRandomValues(new Uint32Array(1))[0];
    snapshot=makeSnapshot({...snapshot,localSeed:seed});
    this.active = { snapshot, previousChoices:this.latest?.result.selected?.choices || this.account.positions.map(p=>Math.sign(p.qty)) };
    this.running=true; this.latest=null; this.pendingPlan=null; this.pending.clear(); this.save();
    this.status(`Frozen snapshot v${snapshot.version}: retuning one joint QAOA circuit (${trigger}). New swipes start the next batch.`);
    $('angle-state').textContent = this.angles ? 'Angles: previous values reused as the starting point; retuning within 48 evaluations.' : 'Angles: first-run initialization; retuning within 48 evaluations.';
    this.worker.postMessage({ type:'optimize', snapshot, previousAngles:this.angles, seed }); this.renderResult(); this.updateAvailability();
  }
  receive(data) {
    if (!this.active || data.snapshotId !== this.active.snapshot.id) return;
    this.running=false;
    if (data.type === 'error') { this.status(`Local circuit failed: ${data.message || data.error || 'unknown error'}. Current positions are held.`); this.updateAvailability(); return; }
    this.latest={snapshot:this.active.snapshot,result:data.result,previousChoices:this.active.previousChoices}; this.runs.push(this.latest); this.runs=this.runs.slice(-6); this.angles=data.result.angles; this.save();
    this.status(this.isHistorical() ? 'The completed snapshot is historical because views or positions changed. It cannot be applied.' : data.result.selected ? 'One joint sampled proposal is ready. Review its paper rebalance before applying.' : 'No feasible sampled candidate. Current portfolio is held; the classical reference remains separate.');
    $('angle-state').textContent='Angles: updated by the fixed-budget local retune.'; this.renderConvictions(); this.renderResult(); this.tryAuto();
  }
  isHistorical() { return !this.latest || this.latest.snapshot.version!==this.version || this.latest.snapshot.accountRevision!==this.account.revision || this.invalidatedByOtherTab; }
  updateAvailability() {
    if (!$('optimize-now')) return;
    let ready=false; try { this.fresh(); ready=true; } catch {}
    $('portfolio-market-status').textContent=ready ? 'All four USDC perpetuals verified · fresh books and reference prices' : 'Waiting for fresh, eligible market inputs across all four instruments';
    $('optimize-now').disabled=this.running || !ready || this.invalidatedByOtherTab;
    $('swipe-cadence').textContent=`${this.pending.size} / 10 directional swipes${this.running?' · next batch':''}`;
    $('apply-proposal').disabled=this.running || !ready || this.isHistorical() || !this.latest?.result.selected;
    $('review-classical').disabled=this.running || !ready || this.isHistorical() || !this.latest?.result.exact;
    $('confirm-paper').disabled=!ready || this.isHistorical() || !this.pendingPlan || this.pendingPlan.version!==this.version;
    $('export-optimization').disabled=!this.latest; $('export-qollab').disabled=!this.latest;
    if (this.pendingPlan && (this.isHistorical() || this.pendingPlan.version!==this.version)) this.pendingPlan=null;
    if (!this.pendingPlan) $('paper-confirm').hidden=true;
  }
  renderConvictions() {
    const values=conviction(this.events,Date.now()), list=$('conviction-rows'); list.replaceChildren();
    for (const [i,c] of values.entries()) { const row=document.createElement('div'); row.className=`conviction-row${c.coin===this.changedCoin?' changed-belief':''}`; const name=document.createElement('span');name.textContent=names[i];const score=document.createElement('strong');score.textContent=c.score.toFixed(3);const bar=document.createElement('span');bar.className='conviction-bar';bar.style.setProperty('--score',String((c.score+1)/2));row.append(name,score,bar);list.append(row); }
    const previewSource=this.active?.snapshot || this.latest?.snapshot;
    let objective, preview;
    try { const base=previewSource || this.snapshot(); preview=makeSnapshot({...base,convictions:values,version:this.version}); objective=buildObjective(preview); } catch {}
    const terms=$('circuit-terms');terms.replaceChildren();
    for(let i=0;i<4;i++){const row=document.createElement('div');row.className=`circuit-term${COINS[i]===this.changedCoin?' changed-belief':''}`;const fields=[2*i,2*i+1].map(q=>objective?-.5*objective.linear[q]-.25*objective.pairs.reduce((sum,p)=>sum+((p.i===q||p.j===q)?p.coefficient:0),0):NaN);row.textContent=`${names[i]} · q${2*i}/q${2*i+1} · Ising Z coefficients ${number(fields[0])} / ${number(fields[1])} → RZ(2γh)`;terms.append(row);}
    const pair=document.createElement('p');pair.className='portfolio-note';pair.textContent='Pairwise covariance links: unchanged by this belief update. Fixed invalid-encoding penalty remains separate.';terms.append(pair);
    if(preview){const choices=this.latest?.result.selected?.choices || this.account.positions.map(p=>Math.sign(p.qty)),b=evaluateChoices(preview,choices).breakdown;const live=document.createElement('p');live.className='portfolio-note';live.id='live-cost-terms';live.textContent=`Live belief edit, holding the last snapshot’s market and account inputs fixed: belief ${number(b.beliefMismatch)} · risk ${number(b.jointRisk)} · turnover ${number(b.turnoverCost)} · funding ${number(b.funding)} · total ${number(b.total)} for ${choices.map(side).join(' / ')}. A fresh run refreezes all inputs.`;terms.append(live);}
    this.updateAvailability();
  }
  renderAccount() {
    const values=this.market?.values() || [], marks=values.map(m=>m.mark), fresh=marks.length===4 && marks.every(p=>Number.isFinite(p)&&p>0) && values.every(m=>Date.now()-m.contextTime<=60_000);
    const flat=this.account.positions.every(p=>!p.qty), metrics=fresh?accountMetrics(this.account,marks):flat?accountMetrics(this.account,[0,0,0,0]):null;
    $('paper-equity').textContent=metrics?money(metrics.equity):'Marks unavailable'; $('paper-unrealized').textContent=metrics?money(metrics.unrealized):'Paused';
    $('paper-realized').textContent=`${money(this.account.realized)} / ${money(this.account.fees)}`;
    $('paper-gross').textContent=metrics?`${pct(metrics.gross)} / 80%`:'Paused / 80%';
    $('paper-margin').textContent=metrics?`1× modeled initial margin ${money(metrics.margin)} · available ${money(metrics.availableMargin)}. Positions and cash are separate.`:'Current reference marks unavailable; positions are held.';
    const positions=$('paper-positions');positions.replaceChildren();
    for (const [i,p] of this.account.positions.entries()) { const n=document.createElement('p');n.className='portfolio-note';n.textContent=`${names[i]}: ${side(p.qty)} · ${Math.abs(p.qty).toLocaleString(undefined,{maximumFractionDigits:8})} contracts · entry ${money(p.entry)}`;positions.append(n); }
    const ledger=$('paper-ledger');ledger.replaceChildren();
    for (const entry of this.account.ledger.slice(-8).reverse()) { const n=document.createElement('p');n.className='portfolio-note';n.textContent=`${entry.at} · ${entry.legs.length} simulated fills · fees ${money(entry.fees)} · snapshot ${entry.snapshotId}`;ledger.append(n); }
  }
  renderResult() {
    const tbody=$('allocation-rows');tbody.replaceChildren();const result=this.latest?.result;
    for(let i=0;i<4;i++){const row=document.createElement('tr');cell(row,names[i],'th').scope='row';cell(row,result?.selected?`${side(result.selected.choices[i])}${result.selected.choices[i]?' 20%':''}`:'—');cell(row,result?.exact?`${side(result.exact.choices[i])}${result.exact.choices[i]?' 20%':''}`:'—');tbody.append(row);}
    if(!result){$('proposal-state').textContent=this.running?'RETUNING · frozen snapshot; paper positions held':'No current local result. Optimize to propose a joint portfolio.';if(this.running){$('run-version').textContent=`Retuning frozen snapshot v${this.active.snapshot.version}; samples have not returned yet.`;$('run-metrics').replaceChildren();$('sample-rows').replaceChildren();$('old-new-cost').textContent='';$('cost-breakdown').textContent='';}this.updateAvailability();return;}
    $('proposal-state').textContent=this.isHistorical()?'HISTORICAL · newer beliefs or positions exist':`LOCAL SIMULATION · frozen snapshot v${this.latest.snapshot.version}`;
    $('proposal-gap').textContent=result.selected?`QAOA sampled cost ${number(result.selected.cost)} · exact ${number(result.exact.cost)} · gap ${number(result.gap)}. Best sampled is not a global-optimum guarantee.`:'No feasible sampled candidate: hold. Exact reference is not substituted.';
    $('circuit-angles').textContent=JSON.stringify(result.angles.map((v,i)=>({angle:['γ₀','β₀','γ₁','β₁'][i],radians:v})),null,2);
    const metrics=$('run-metrics');metrics.replaceChildren();
    for(const [label,value]of [['Feasible samples',`${result.metrics.feasibleSamples} / ${result.metrics.shots} (${pct(result.metrics.feasibleRate)})`],['Optimal sampling frequency',pct(result.metrics.optimalFrequency)],['Retune / budget',`${result.metrics.evaluations} / 48 evaluations`],['Warm start',result.metrics.warmStarted?'Previous angles':'Initial angles'],['CPU retune / sampling',`${result.timing.retuneMs.toFixed(1)} / ${result.timing.samplingMs.toFixed(1)} ms`],['Exact reference CPU',`${result.timing.referenceMs.toFixed(1)} ms`],['Circuit resources',`8 qubits · 2 layers · ${result.resources.gates} gates`]]){const box=document.createElement('div');cell(box,label,'dt');cell(box,value,'dd');metrics.append(box);}
    $('run-version').textContent=`Snapshot ${this.latest.snapshot.id} · v${this.latest.snapshot.version} · ${new Date(this.latest.snapshot.createdAt).toLocaleString()} · frozen equity ${money(this.latest.snapshot.equity)}. Reference and sample use exactly the same objective.`;
    if(result.selected){const previous=evaluateChoices(this.latest.snapshot,this.latest.previousChoices);$('old-new-cost').textContent=`Previous proposal under this updated objective: ${number(previous.cost)} → selected ${number(result.selected.cost)}. No comparison across different objectives.`;const b=result.selected.breakdown;const f=financeMetrics(this.latest.snapshot,result.selected.choices);$('cost-breakdown').textContent=`Dimensionless: belief ${number(b.beliefMismatch)} · joint risk ${number(b.jointRisk)} · turnover ${number(b.turnoverCost)} · funding ${number(b.funding)} · invalid 0. Separate financial estimates: execution ${money(f.turnoverDollars)}, 24 h funding ${money(f.fundingDollars)}, portfolio volatility ${pct(f.portfolioVolatility)}, gross ${pct(f.gross)}.`;}
    const samples=$('sample-rows');samples.replaceChildren();
    for(const item of [...result.distribution].sort((a,b)=>b.count-a.count)){const row=document.createElement('tr');cell(row,item.choices?item.choices.map(side).join(' / '):`Invalid 11 · ${item.bitstring}`);cell(row,String(item.count));cell(row,pct(item.count/result.metrics.shots));cell(row,number(item.cost));cell(row,item.feasible?'Yes':'No');samples.append(row);}
    this.updateAvailability();
  }
  review(mode) {
    if(this.isHistorical())return;
    const selected=mode==='classical'?this.latest.result.exact:this.latest.result.selected;
    if(!selected)return;
    try{const plan=planPaperRebalance(this.account,selected.choices,this.fresh(),{snapshotId:this.latest.snapshot.id});this.pendingPlan={mode,version:this.version,choices:selected.choices,plan};$('paper-confirm').hidden=false;$('paper-confirm-note').textContent=`${mode==='classical'?'EXACT CLASSICAL REFERENCE':'QAOA ACTUALLY SAMPLED CANDIDATE'} · ${plan.noChange?'No change is a valid outcome; no fills or fees.':`${plan.legs.length} simulated legs; estimated fill fees ${money(plan.legs.reduce((s,l)=>s+l.fee,0))}.`} Quotes are rechecked on confirmation.`;const legs=$('paper-legs');legs.replaceChildren();for(const l of plan.legs){const n=document.createElement('p');n.className='portfolio-note';n.textContent=`${l.coin} ${l.side} ${l.filledQty.toLocaleString(undefined,{maximumFractionDigits:8})} @ ${money(l.price)} · fees ${money(l.fee)}`;legs.append(n);}this.updateAvailability();}catch(e){this.status(e.message);}
  }
  apply() {
    if(!this.pendingPlan || this.isHistorical() || this.pendingPlan.version!==this.version)return;
    try{const p=this.pendingPlan;const plan=planPaperRebalance(this.account,p.choices,this.fresh(),{snapshotId:this.latest.snapshot.id});if(Date.now()-p.plan.createdAt>60_000)throw new Error('Paper confirmation expired. Review fresh execution quotes again.');const quoted=p.plan.legs.reduce((s,l)=>s+l.notional,0),fresh=plan.legs.reduce((s,l)=>s+l.notional,0);if(quoted&&Math.abs(fresh-quoted)/quoted>.005)throw new Error('Execution quote changed by more than 50 bp. Review the rebalance again.');this.account=plan.next;this.pendingPlan=null;$('paper-confirm').hidden=true;if(!plan.noChange)this.version++;this.save();this.renderAccount();this.renderResult();this.status(plan.noChange?'No-change portfolio confirmed. No fills, fees or position changes.':`${p.mode==='classical'?'Classical':'Sampled QAOA'} paper rebalance applied. All quantities, fills and fees are simulated; no exchange orders were sent.`);}catch(e){this.status(e.message);this.pendingPlan=null;$('paper-confirm').hidden=true;this.updateAvailability();}
  }
  exportRun(qollab) {
    if(!this.latest)return;
    const {snapshot,result}=this.latest,objective=buildObjective(snapshot);
    const artifact={schema:'almond.joint-portfolio.snapshot.v1',mode:'local-statevector-simulation',historical:this.isHistorical(),snapshot,result,bitOrder:'q0 leftmost; each pair long,short in BTC/SP500/Brent/Gold order',objective:{linear:objective.linear,pairs:objective.pairs,offset:objective.offset,invalidPenalty:objective.invalidPenalty},circuit:buildIonQCircuit(snapshot,result.angles),note:'Frozen one-off evaluation only. No automatic provider submissions; no quantum speedup claim.'};
    download(qollab?'snapshot.json':`almond-portfolio-${snapshot.id}.json`,artifact);
  }
}
