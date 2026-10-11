/**
 * Bounded four-asset research model. These are modeled beliefs, covariance,
 * friction and funding estimates, not calibrated forecasts or an execution
 * strategy. Eight-qubit classical state-vector simulation is not speedup.
 * All objectives are dimensionless. Dollars below are separately derived.
 */
export const COINS = Object.freeze(['BTC', 'xyz:SP500', 'xyz:BRENTOIL', 'xyz:GOLD']);
export const DEFAULTS = Object.freeze({
  slot: .2, grossLimit: .8, horizonHours: 24, decayHalfLifeHours: 24,
  evidenceWeight: .5, thesisCap: 1, localShots: 1024, layers: 2,
  evaluationBudget: 48, beliefWeight: 1, riskWeight: .15,
  turnoverWeight: .5, fundingWeight: 1, riskNormalization: .0004,
  moneyNormalization: .001, invalidPenalty: .5, minimumImprovement: .0001,
  feeRate: .0005, spreadBps: 2, slippageBps: 1,
});
const DIMENSION = 256;
const EPS = 1e-10;
const clamp = (v, low, high) => Math.max(low, Math.min(high, v));
const finite = (v, name) => { const n = Number(v); if (!Number.isFinite(n)) throw new TypeError(`${name} must be finite`); return n; };
const clock = () => globalThis.performance?.now?.() ?? Date.now();
const clone = value => Array.isArray(value) ? value.map(clone) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) : value;
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function settingsFor(input = {}) {
  const settings = { ...DEFAULTS, ...input };
  for (const key of Object.keys(DEFAULTS)) settings[key] = finite(settings[key], key);
  if (settings.slot <= 0 || settings.slot > DEFAULTS.slot || settings.grossLimit <= 0 || settings.grossLimit > DEFAULTS.grossLimit) throw new RangeError('Slot and gross limit must be positive and cannot exceed the 20% / 80% model limits');
  for (const key of ['horizonHours', 'decayHalfLifeHours', 'riskNormalization', 'moneyNormalization', 'invalidPenalty']) if (settings[key] <= 0) throw new RangeError(`${key} must be positive`);
  for (const key of ['evidenceWeight', 'thesisCap', 'beliefWeight', 'riskWeight', 'turnoverWeight', 'fundingWeight', 'feeRate', 'spreadBps', 'slippageBps', 'minimumImprovement']) if (settings[key] < 0) throw new RangeError(`${key} cannot be negative`);
  if (settings.thesisCap > 1) throw new RangeError('Same-thesis evidence cap cannot exceed 1');
  for (const [key, maximum] of [['localShots', 4096], ['layers', 2], ['evaluationBudget', 48]]) if (!Number.isInteger(settings[key]) || settings[key] < 1 || settings[key] > maximum) throw new RangeError(`${key} must be an integer from 1 to ${maximum}`);
  return settings;
}

/** Distinct event IDs, bounded signed evidence per thesis, exponentially decayed. */
export function conviction(events = [], now = Date.now(), settings = {}) {
  const opts = settingsFor(settings), at = finite(now, 'now');
  const unique = new Map();
  for (const [index, event] of events.entries()) {
    if (!event || !COINS.includes(event.coin) || ![1, -1].includes(event.direction) || !Number.isFinite(Number(event.at))) continue;
    const key = event.id == null ? `anonymous-${index}` : String(event.id);
    const old = unique.get(key);
    if (!old || Number(event.at) >= Number(old.at)) unique.set(key, event);
  }
  const priors = opts.initialConvictions == null ? [0,0,0,0] : vector(opts.initialConvictions, 'initialConvictions', (value,i) => clamp(finite(value, `initialConvictions[${i}]`), -.999999999999, .999999999999));
  return COINS.map((coin, coinIndex) => {
    const grouped = new Map();
    for (const event of unique.values()) {
      if (event.coin !== coin) continue;
      const thesis = String(event.thesis ?? event.id ?? 'unclassified').trim().toLowerCase().replace(/\s+/g, ' ') || 'unclassified';
      const ageHours = Math.max(0, at - Number(event.at)) / 3600000;
      const decayed = event.direction * 2 ** (-ageHours / opts.decayHalfLifeHours);
      grouped.set(thesis, (grouped.get(thesis) || 0) + decayed);
    }
    const theses = Array.from(grouped, ([thesis, rawEvidence]) => ({ thesis, rawEvidence, evidence: clamp(rawEvidence, -opts.thesisCap, opts.thesisCap) }));
    const evidence = theses.reduce((sum, item) => sum + item.evidence, 0);
    return { coin, score: Math.tanh(Math.atanh(priors[coinIndex]) + opts.evidenceWeight * evidence), evidence, theses };
  });
}
function vector(input, name, mapper = (v, i) => finite(v, `${name}[${i}]`)) {
  if (!Array.isArray(input) || input.length !== 4) throw new TypeError(`${name} must contain four entries in COINS order`);
  return input.map(mapper);
}
function covarianceFor(input) {
  const covariance = vector(input, 'covariance', (row, i) => vector(row, `covariance[${i}]`));
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (Math.abs(covariance[i][j] - covariance[j][i]) > 1e-10) throw new RangeError('Covariance must be symmetric');
  // Semidefinite Cholesky with zero-pivot checking also accepts rank-deficient priors.
  const l = Array.from({ length: 4 }, () => Array(4).fill(0));
  for (let i = 0; i < 4; i++) for (let j = 0; j <= i; j++) {
    let residual = covariance[i][j];
    for (let k = 0; k < j; k++) residual -= l[i][k] * l[j][k];
    if (i === j) { if (residual < -1e-12) throw new RangeError('Covariance must be positive semidefinite'); l[i][j] = Math.sqrt(Math.max(0, residual)); }
    else if (l[j][j] > 1e-12) l[i][j] = residual / l[j][j];
    else if (Math.abs(residual) > 1e-12) throw new RangeError('Covariance must be positive semidefinite');
  }
  return covariance;
}
/** Every run receives an isolated immutable copy, including prices and holdings. */
export function makeSnapshot(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Snapshot input is required');
  const settings = settingsFor(input.settings);
  const prices = vector(input.prices, 'prices');
  if (prices.some(p => p <= 0)) throw new RangeError('Snapshot prices must be positive');
  const equity = finite(input.equity, 'equity');
  if (equity <= 0) throw new RangeError('Snapshot equity must be positive');
  const convictions = vector(input.convictions, 'convictions', (value, i) => clamp(finite(typeof value === 'object' ? value?.score : value, `convictions[${i}]`), -1, 1));
  const executionRates = input.executionRates ? vector(input.executionRates, 'executionRates', (rate, i) => {
    if (typeof rate === 'number') { if (!Number.isFinite(rate) || rate < 0) throw new RangeError('Execution rates cannot be negative'); return { feeRate: rate, spreadBps: 0, slippageBps: 0, allIn: true }; }
    const result = { feeRate: rate?.feeRate ?? settings.feeRate, spreadBps: rate?.spreadBps ?? settings.spreadBps, slippageBps: rate?.slippageBps ?? settings.slippageBps };
    for (const key of Object.keys(result)) { result[key] = finite(result[key], `executionRates[${i}].${key}`); if (result[key] < 0) throw new RangeError('Execution rates cannot be negative'); }
    return result;
  }) : COINS.map(() => ({ feeRate: settings.feeRate, spreadBps: settings.spreadBps, slippageBps: settings.slippageBps }));
  if (input.experiment?.forceRebalance) vector(input.experiment.previousChoices ?? input.holdings?.map(Math.sign) ?? [0,0,0,0], 'previousChoices', c=>{if(![-1,0,1].includes(c))throw new TypeError('Invalid previous choices');return c;});
  const version = finite(input.version ?? 0, 'version');
  if (!Number.isInteger(version) || version < 0) throw new RangeError('Snapshot version must be a nonnegative integer');
  return freeze({ ...clone(input), id: String(input.id ?? `snapshot-${version}`), version,
    createdAt: finite(input.createdAt ?? Date.now(), 'createdAt'), convictions, prices,
    covariance: covarianceFor(input.covariance), holdings: vector(input.holdings ?? [0, 0, 0, 0], 'holdings'), equity,
    fundingRates: vector(input.fundingRates ?? [0, 0, 0, 0], 'fundingRates'), executionRates, settings,
    covarianceLabel: String(input.covarianceLabel ?? 'Modeled daily PSD covariance prior; not measured return correlations'),
  });
}
export function stateToChoices(state) {
  if (!Number.isInteger(state) || state < 0 || state >= DIMENSION) throw new RangeError('State must be an integer from 0 to 255');
  const choices = [];
  for (let i = 0; i < 4; i++) { const pair = (state >> (2 * i)) & 3; if (pair === 3) return null; choices.push(pair === 1 ? 1 : pair === 2 ? -1 : 0); }
  return choices;
}
export function choicesToState(choices) {
  vector(choices, 'choices');
  return choices.reduce((state, choice, i) => { if (![0, 1, -1].includes(choice)) throw new RangeError('Each choice must be -1, 0 or 1'); return state | ((choice === 1 ? 1 : choice === -1 ? 2 : 0) << (2 * i)); }, 0);
}
/** q0 is the LEFTMOST displayed bit. Each LS pair is long,short in COINS order. */
export const stateBitstring = state => {
  if (!Number.isInteger(state) || state < 0 || state >= DIMENSION) throw new RangeError('State must be an integer from 0 to 255');
  return Array.from({ length: 8 }, (_, q) => (state >> q) & 1).join('');
};
const frictionRate = rate => rate.feeRate + rate.spreadBps / 20000 + rate.slippageBps / 10000;
function rawFinance(snapshot, choices) {
  const { settings: s } = snapshot;
  const weights = choices.map(choice => choice * s.slot);
  const oldWeights = snapshot.holdings.map((quantity, i) => quantity * snapshot.prices[i] / snapshot.equity);
  const turnover = weights.map((weight, i) => Math.abs(weight - oldWeights[i]));
  const turnoverFraction = turnover.reduce((total, amount, i) => total + amount * frictionRate(snapshot.executionRates[i]), 0);
  const fundingFraction = weights.reduce((total, weight, i) => total + weight * snapshot.fundingRates[i] * s.horizonHours, 0);
  let variance = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) variance += weights[i] * snapshot.covariance[i][j] * weights[j];
  variance = Math.max(0, variance * s.horizonHours / 24);
  const beliefMismatch = s.beliefWeight * choices.reduce((total, choice, i) => total + (choice - snapshot.convictions[i]) ** 2, 0) / 4;
  const jointRisk = s.riskWeight * variance / s.riskNormalization;
  const turnoverCost = s.turnoverWeight * turnoverFraction / s.moneyNormalization;
  const funding = s.fundingWeight * fundingFraction / s.moneyNormalization;
  return { weights, oldWeights, gross: weights.reduce((sum, weight) => sum + Math.abs(weight), 0),
    beliefMismatch, jointRisk, turnover: turnoverCost, turnoverCost, funding, invalidEncoding: 0,
    turnoverFractions: turnover, turnoverDollars: turnoverFraction * snapshot.equity,
    fundingDollars: fundingFraction * snapshot.equity, portfolioVariance: variance,
    portfolioVolatility: Math.sqrt(variance), total: beliefMismatch + jointRisk + turnoverCost + funding };
}
export function evaluateChoices(snapshotInput, choices) {
  const snapshot = makeSnapshot(snapshotInput);
  choicesToState(choices);
  const breakdown = rawFinance(snapshot, choices);
  return { cost: breakdown.total, breakdown, weights: breakdown.weights, gross: breakdown.gross,
    turnover: breakdown.turnoverFractions, feasible: breakdown.gross <= snapshot.settings.grossLimit + EPS };
}
export function financeMetrics(snapshotInput, choices) {
  const { breakdown } = evaluateChoices(snapshotInput, choices);
  return Object.fromEntries(['weights', 'oldWeights', 'gross', 'turnoverDollars', 'fundingDollars', 'portfolioVariance', 'portfolioVolatility'].map(key => [key, breakdown[key]]));
}
/** Continuous marked current holdings are an extra Hold option outside the 81-grid. */
export function evaluateHeld(snapshotInput) {
  const snapshot=makeSnapshot(snapshotInput);
  const weights=snapshot.holdings.map((q,i)=>q*snapshot.prices[i]/snapshot.equity);
  const normalized=weights.map(w=>w/snapshot.settings.slot);
  const breakdown=rawFinance(snapshot,normalized);
  return { cost:breakdown.total,breakdown,weights,gross:breakdown.gross,
    feasible:breakdown.gross<=snapshot.settings.grossLimit+EPS,
    offGrid:normalized.some(x=>![-1,0,1].some(y=>Math.abs(x-y)<=EPS)),
    label:'Continuous current holdings (Hold option; outside discrete reference grid)' };
}
export function compareWithHold(snapshotInput, selected) {
  const snapshot=makeSnapshot(snapshotInput),held=evaluateHeld(snapshot);
  const improvement=selected?held.cost-selected.cost:null;
  return {heldCost:held.cost,candidateCost:selected?.cost??null,improvement,
    minimumImprovement:snapshot.settings.minimumImprovement,
    eligible:!!selected&&improvement>=snapshot.settings.minimumImprovement,
    held,reason:!selected?'No feasible sampled candidate; hold current quantities.':
      improvement<snapshot.settings.minimumImprovement?'Candidate does not exceed the stated minimum improvement over current holdings.':
      'Candidate clears the objective improvement threshold; freshness and paper risk checks still apply.'};
}
function rawChoices(state) { return COINS.map((_, i) => ((state >> (2 * i)) & 1) - ((state >> (2 * i + 1)) & 1)); }
/**
 * Exact 8-bit QUBO lifting. Within-asset absolute turnover is a four-entry
 * table on two binary variables, so its quadratic lift is exact.
 * Same-asset 11 is invalid, NOT flat. Tighter custom gross limits are a CPU
 * feasibility filter; no nonexistent quadratic cutoff is claimed.
 */
export function buildObjective(snapshotInput) {
  const snapshot = makeSnapshot(snapshotInput);
  const s = snapshot.settings;
  const offset = rawFinance(snapshot, [0, 0, 0, 0]).total;
  const oldWeights = snapshot.holdings.map((q, i) => q*snapshot.prices[i]/snapshot.equity);
  const riskScale = s.riskWeight*s.horizonHours/24/s.riskNormalization;
  const turnoverFor = (asset, choice) => s.turnoverWeight*frictionRate(snapshot.executionRates[asset])*Math.abs(choice*s.slot-oldWeights[asset])/s.moneyNormalization;
  const linear = Array.from({ length: 8 }, (_, bit) => {
    const asset = Math.floor(bit/2), sign = bit%2 === 0 ? 1 : -1;
    return s.beliefWeight*(1-2*sign*snapshot.convictions[asset])/4
      +riskScale*s.slot*s.slot*snapshot.covariance[asset][asset]
      +turnoverFor(asset, sign)-turnoverFor(asset, 0)
      +s.fundingWeight*sign*s.slot*snapshot.fundingRates[asset]*s.horizonHours/s.moneyNormalization;
  });
  const invalidPenalty = s.invalidPenalty;
  const pairs = [];
  for (let i=0; i<8; i++) for (let j=i+1; j<8; j++) {
    const a=Math.floor(i/2), b=Math.floor(j/2), signI=i%2===0?1:-1, signJ=j%2===0?1:-1;
    const coefficient = a===b
      ? -s.beliefWeight/2-2*riskScale*s.slot*s.slot*snapshot.covariance[a][a]
        +2*turnoverFor(a,0)-turnoverFor(a,1)-turnoverFor(a,-1)+invalidPenalty
      : 2*riskScale*s.slot*s.slot*snapshot.covariance[a][b]*signI*signJ;
    pairs.push({i,j,coefficient});
  }
  if (![offset,invalidPenalty,...linear,...pairs.map(pair=>pair.coefficient)].every(Number.isFinite)) throw new RangeError('Snapshot objective exceeds finite numeric bounds');
  const evaluateState = state => {
    if (!Number.isInteger(state) || state < 0 || state >= DIMENSION) throw new RangeError('State must be an integer from 0 to 255');
    let cost = offset;
    for (let i = 0; i < 8; i++) if ((state >> i) & 1) cost += linear[i];
    for (const { i, j, coefficient } of pairs) if (((state >> i) & 1) && ((state >> j) & 1)) cost += coefficient;
    return cost;
  };
  const costBreakdown = stateOrChoices => {
    const state = Array.isArray(stateOrChoices) ? choicesToState(stateOrChoices) : stateOrChoices;
    evaluateState(state);
    const data = rawFinance(snapshot, rawChoices(state));
    const invalidCount = COINS.reduce((sum, _, i) => sum + (((state >> (2 * i)) & 3) === 3 ? 1 : 0), 0);
    data.invalidEncoding = invalidCount * invalidPenalty;
    data.total += data.invalidEncoding;
    return data;
  };
  return { snapshotId: snapshot.id, linear, pairs, offset, invalidPenalty, penaltyProof: 'Repairing each 11 pair to 00 preserves economic exposures and lowers the objective by P',
    evaluateState, costBreakdown, encoding: { qubits: 8, displayOrder: 'q0 first (leftmost)', pairs: COINS.map((coin, i) => ({ coin, long: 2*i, short: 2*i+1, invalid: '11' })) } };
}
/** Demo constraint is a post-sampling filter, shared with the exact reference. */
export function allowedTarget(snapshot, choices) {
  if (!choices) return false;
  if (!snapshot.experiment?.forceRebalance) return true;
  const previous = snapshot.experiment.previousChoices ?? snapshot.holdings.map(Math.sign);
  return choices.some(c=>c!==0) && choices.some((c,i)=>c!==previous[i]);
}
/** Independent classical reference enumerates the 3^4 choices, not QUBO states. */
export function solveExact(snapshotInput) {
  const snapshot = makeSnapshot(snapshotInput);
  let best = null;
  for (let code = 0; code < 81; code++) {
    let remainder = code;
    const choices = COINS.map(() => { const digit = remainder % 3; remainder = Math.floor(remainder / 3); return digit === 0 ? 0 : digit === 1 ? 1 : -1; });
    const breakdown = rawFinance(snapshot, choices);
    if (breakdown.gross > snapshot.settings.grossLimit + EPS || !allowedTarget(snapshot,choices)) continue;
    const state = choicesToState(choices), cost = breakdown.total;
    if (!best || cost < best.cost - EPS || (Math.abs(cost-best.cost) <= EPS && state < best.state)) best = { state, bitstring: stateBitstring(state), choices, cost, breakdown };
  }
  return best;
}
export function seededRandom(seed = 1) {
  let value = typeof seed === 'number' ? seed >>> 0 : Array.from(String(seed)).reduce((a, c) => Math.imul(a ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
  return () => { value += 0x6D2B79F5; let n = value; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
}
/** exp(-i gamma C) then exp(-i beta sum X); all angles are radians. */
export function simulateQaoa(objectiveOrCosts, angles) {
  if (!Array.isArray(angles) || !angles.length || angles.length % 2 || angles.some(angle => !Number.isFinite(angle))) throw new TypeError('Angles must be finite gamma,beta pairs');
  const costs = Array.isArray(objectiveOrCosts) || ArrayBuffer.isView(objectiveOrCosts) ? objectiveOrCosts : Array.from({ length: DIMENSION }, (_, state) => objectiveOrCosts.evaluateState(state));
  if (costs.length !== DIMENSION || Array.from(costs).some(cost => !Number.isFinite(cost))) throw new TypeError('QAOA requires 256 finite diagonal costs');
  const real = new Float64Array(DIMENSION).fill(1/16), imaginary = new Float64Array(DIMENSION);
  for (let layer = 0; layer < angles.length / 2; layer++) {
    const gamma = angles[2 * layer], beta = angles[2 * layer + 1];
    for (let state = 0; state < DIMENSION; state++) {
      const phase = -gamma * costs[state], c = Math.cos(phase), s = Math.sin(phase), r = real[state], im = imaginary[state];
      real[state] = r * c - im * s; imaginary[state] = r * s + im * c;
    }
    const c = Math.cos(beta), s = Math.sin(beta);
    for (let q = 0; q < 8; q++) for (let state = 0; state < DIMENSION; state++) {
      if (state & (1 << q)) continue;
      const other = state | (1 << q), ar = real[state], ai = imaginary[state], br = real[other], bi = imaginary[other];
      real[state] = c * ar + s * bi; imaginary[state] = c * ai - s * br;
      real[other] = c * br + s * ai; imaginary[other] = c * bi - s * ar;
    }
  }
  const probabilities = Array.from(real, (r, state) => r*r + imaginary[state]*imaginary[state]);
  const normalization = probabilities.reduce((sum, p) => sum+p, 0);
  return { real, imaginary, probabilities, normalization,
    expectedCost: probabilities.reduce((sum, p, state) => sum + p * costs[state], 0) };
}
function anglesFor(input, layers) {
  if (Array.isArray(input) && input.length === layers * 2 && input.every(Number.isFinite)) return { angles: input.slice(), warmStarted: true };
  if (input && Array.isArray(input.gammas) && Array.isArray(input.betas) && input.gammas.length === layers && input.betas.length === layers) return anglesFor(input.gammas.flatMap((gamma, i) => [gamma, input.betas[i]]), layers);
  return { angles: Array.from({ length: layers }, (_, i) => [.17 + i*.11, .31 - i*.04]).flat(), warmStarted: false };
}
/** Selects strictly among actual sampled states. Reference truth never substitutes. */
export function selectSampled(snapshotInput, counts, objectiveInput) {
  const snapshot = makeSnapshot(snapshotInput), objective = objectiveInput ?? buildObjective(snapshot);
  if (counts.length !== DIMENSION || Array.from(counts).some(n => !Number.isInteger(n) || n < 0)) throw new TypeError('Counts must be 256 nonnegative integers');
  let selected = null;
  const distribution = [], exact = solveExact(snapshot);
  const shots = Array.from(counts).reduce((sum, n) => sum+n, 0);
  let feasibleSamples = 0, validSamples = 0, optimalSamples = 0;
  for (let state = 0; state < DIMENSION; state++) {
    const count = counts[state]; if (!count) continue;
    const choices = stateToChoices(state), breakdown = objective.costBreakdown(state), cost = objective.evaluateState(state);
    const feasible = allowedTarget(snapshot,choices) && breakdown.gross <= snapshot.settings.grossLimit + EPS;
    distribution.push({ state, bitstring: stateBitstring(state), choices, count, probability: shots ? count/shots : 0, cost, feasible });
    if (choices) validSamples += count;
    if (!feasible) continue;
    feasibleSamples += count;
    if (exact && Math.abs(cost - exact.cost) <= EPS) optimalSamples += count;
    if (!selected || cost < selected.cost - EPS || (Math.abs(cost-selected.cost) <= EPS && state < selected.state)) selected = { state, bitstring: stateBitstring(state), choices, cost, breakdown, count };
  }
  return { distribution, selected, exact, gap: selected && exact ? Math.max(0, selected.cost-exact.cost) : null,
    metrics: { shots, validSamples, validityRate: shots ? validSamples/shots : 0, feasibleSamples, feasibleRate: shots ? feasibleSamples/shots : 0, optimalFrequency: shots ? optimalSamples/shots : 0 },
    holdReason: selected ? null : 'No gross-feasible valid portfolio was sampled. Hold current quantities; no exact-reference fallback.' };
}
/** Both classical random baselines have exactly the same returned-shot budget. */
export function randomSamplingBaselines(snapshotInput, seed=1) {
  const snapshot=makeSnapshot(snapshotInput),shots=snapshot.settings.localShots;
  const objective=buildObjective(snapshot),validStates=[];
  for(let state=0;state<DIMENSION;state++)if(allowedTarget(snapshot,stateToChoices(state)))validStates.push(state);
  const baseline=(name,candidates,baselineSeed)=>{
    const rng=seededRandom(baselineSeed),counts=new Uint32Array(DIMENSION);
    for(let i=0;i<shots;i++)counts[candidates[Math.floor(rng()*candidates.length)]]++;
    return {name,seed:baselineSeed,expectedValidityRate:candidates.length===DIMENSION?81/256:1,
      ...selectSampled(snapshot,counts,objective)};
  };
  return {rawBits:baseline('Uniform raw 256 bitstrings',Array.from({length:DIMENSION},(_,i)=>i),`${seed}:raw`),
    validPortfolios:baseline(`Uniform ${validStates.length} eligible portfolios`,validStates,`${seed}:valid`)};
}
/** Fixed-budget warm-started coordinate/random tuning against exact CPU expectations. */
export function optimizeLocal(snapshotInput, previousAngles = null, seed = 1, testOptions = {}) {
  const started = clock(), snapshot = makeSnapshot(snapshotInput), objective = buildObjective(snapshot);
  const emit = (stage, percent, message) => testOptions.onProgress?.({stage, percent, message, elapsedMs:clock()-started});
  emit('prepare', 3, 'Building frozen QUBO costs for 256 basis states; preparing Hadamard superposition.');
  const costs = Array.from({ length: DIMENSION }, (_, state) => objective.evaluateState(state));
  const rng = seededRandom(seed), initialization = anglesFor(previousAngles, snapshot.settings.layers);
  let angles = initialization.angles, best = simulateQaoa(costs, angles), evaluations = 1;
  const initialExpectedCost = best.expectedCost;
  emit('retune', 5, `Evaluation 1/${snapshot.settings.evaluationBudget} · expected cost ${best.expectedCost.toFixed(6)}`);
  while (evaluations < snapshot.settings.evaluationBudget) {
    const proposal = angles.slice(), index = (evaluations-1) % proposal.length;
    const round = Math.floor((evaluations-1) / (proposal.length * 2));
    const step = .38 * .8 ** round;
    proposal[index] += ((evaluations-1) % (proposal.length*2) < proposal.length ? 1 : -1) * step;
    if (evaluations % 9 === 0) for (let q = 0; q < proposal.length; q++) proposal[q] += (rng()-.5) * .3;
    const candidate = simulateQaoa(costs, proposal); evaluations++;
    if (candidate.expectedCost < best.expectedCost) { angles = proposal; best = candidate; }
    emit('retune', 5+75*evaluations/snapshot.settings.evaluationBudget, `Evaluation ${evaluations}/${snapshot.settings.evaluationBudget} · best expected cost ${best.expectedCost.toFixed(6)} · cost-phase / mixer layers simulated`);
  }
  const tuned = clock(), counts = new Uint32Array(DIMENSION), shots = snapshot.settings.localShots;
  emit('sample', 85, `Sampling ${shots} shots from the tuned state-vector distribution.`);
  if (testOptions.sampleStates) {
    if (testOptions.sampleStates.length !== shots) throw new RangeError('Injected sample count must equal configured shots');
    for (const state of testOptions.sampleStates) { if (!Number.isInteger(state) || state < 0 || state >= DIMENSION) throw new RangeError('Injected states must be integers from 0 to 255'); counts[state]++; }
  } else {
    const cumulative = [], sum = best.probabilities.reduce((a, b) => a+b, 0); let total = 0;
    best.probabilities.forEach(p => { total += p/sum; cumulative.push(total); });
    for (let sample = 0; sample < shots; sample++) { const u = rng(); let low = 0, high = DIMENSION-1; while (low < high) { const mid = (low+high)>>1; if (u < cumulative[mid]) high = mid; else low = mid+1; } counts[low]++; }
  }
  const sampled = clock(), referenceStarted = clock();
  emit('reference', 92, 'Selecting only feasible sampled portfolios; exhaustively checking all 81 classical targets.');
  const outcome = selectSampled(snapshot, counts, objective), finished = clock();
  const circuit = buildIonQCircuit(snapshot, angles);
  const holdComparison=compareWithHold(snapshot,outcome.selected);
  emit('reference', 96, 'Comparing Hold and shot-matched random baselines.');
  const baselineStarted=clock(),randomBaselines=randomSamplingBaselines(snapshot,seed),baselineFinished=clock();
  return { snapshotId: snapshot.id, snapshotVersion: snapshot.version, seed, angles, ...outcome, holdComparison, randomBaselines,
    benchmarkBudgetNote: 'Random baselines match final shots only; QAOA additionally uses exact CPU state-vector training evaluations. This is not a total-compute-matched speedup comparison.',
    metrics: { ...outcome.metrics, evaluations, expectedCost: best.expectedCost, initialExpectedCost,
      warmStarted: initialization.warmStarted, normalization: best.normalization,
      training: 'Exact local CPU state-vector expectation; not shot-estimated or QPU training' },
    resources: { qubits: 8, layers: snapshot.settings.layers, gates: circuit.circuit.length,
      statevectorAmplitudes: DIMENSION, shots, oracleCalls: 0, candidates: 81,
      classicalReference: 'Exhaustive 81-portfolio CPU search', costLayers: snapshot.settings.layers,
      encoding: objective.encoding },
    timing: { retuneMs: tuned-started, samplingMs: sampled-tuned, referenceMs: finished-referenceStarted, randomBaselineMs: baselineFinished-baselineStarted, totalMs: clock()-started },
    methodology: 'QSwipe joint bounded QAOA model simulated classically; DOCX teaching normalization, modeled covariance and friction. No quantum speedup or measured trading performance claim.' };
}
/** QIS rotation is radians: https://docs.ionq.com/api-reference/v0.3/writing-quantum-programs */
export function buildIonQCircuit(snapshotInput, angles) {
  const snapshot = makeSnapshot(snapshotInput), objective = buildObjective(snapshot);
  if (!Array.isArray(angles) || angles.length !== snapshot.settings.layers*2 || angles.some(v => !Number.isFinite(v))) throw new TypeError('Circuit requires one finite gamma,beta pair per layer');
  // x_i=(1-Z_i)/2: h_i=-a_i/2-sum_j b_ij/4; J_ij=b_ij/4.
  const h = objective.linear.map(a => -a/2);
  for (const { i, j, coefficient } of objective.pairs) { h[i] -= coefficient/4; h[j] -= coefficient/4; }
  const circuit = Array.from({ length: 8 }, (_, target) => ({ gate: 'h', target }));
  for (let layer = 0; layer < snapshot.settings.layers; layer++) {
    const gamma = angles[layer*2], beta = angles[layer*2+1];
    for (let target = 0; target < 8; target++) if (Math.abs(h[target]) > 1e-12) circuit.push({ gate: 'rz', target, rotation: 2*gamma*h[target] });
    for (const { i, j, coefficient } of objective.pairs) if (Math.abs(coefficient) > 1e-12) {
      circuit.push({ gate: 'cnot', control: i, target: j }, { gate: 'rz', target: j, rotation: gamma*coefficient/2 }, { gate: 'cnot', control: i, target: j });
    }
    for (let target = 0; target < 8; target++) circuit.push({ gate: 'rx', target, rotation: 2*beta });
  }
  return { format: 'ionq.circuit.v0', qubits: 8, gateset: 'qis', circuit };
}
