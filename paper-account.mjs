export const PAPER_COINS = ['BTC', 'xyz:SP500', 'xyz:BRENTOIL', 'xyz:GOLD'];
export const PAPER_FEE = .0005;

export function newPaperAccount() {
  return { schema: 1, revision: 0, initialBalance: 10_000, balance: 10_000, realized: 0, fees: 0, funding: 0, positions: PAPER_COINS.map(coin => ({ coin, qty: 0, entry: 0 })), ledger: [] };
}

export function restorePaperAccount(raw) {
  if (!raw || raw.schema !== 1 || !Number.isSafeInteger(raw.revision) || raw.revision < 0 || ![raw.balance, raw.realized, raw.fees, raw.funding].every(Number.isFinite) || raw.balance <= 0 || raw.initialBalance !== 10_000 || !Array.isArray(raw.positions) || raw.positions.length !== 4 || raw.positions.some((p, i) => p.coin !== PAPER_COINS[i] || !Number.isFinite(p.qty) || !Number.isFinite(p.entry) || p.entry < 0 || (p.qty && !p.entry))) return newPaperAccount();
  return structuredClone({ ...raw, ledger: Array.isArray(raw.ledger) ? raw.ledger.slice(-500) : [] });
}

export function accountMetrics(account, marks) {
  const unrealized = account.positions.reduce((s, p, i) => s + (p.qty ? p.qty * (marks[i] - p.entry) : 0), 0);
  const equity = account.balance + unrealized;
  const grossDollars = account.positions.reduce((s, p, i) => s + Math.abs(p.qty) * marks[i], 0);
  return { equity, unrealized, realized: account.realized, fees: account.fees, grossDollars, gross: equity > 0 ? grossDollars / equity : Infinity, margin: grossDollars, availableMargin: equity - grossDollars };
}

export function consumeBook(levels, quantity) {
  if (!Number.isFinite(quantity) || quantity < 0 || !Array.isArray(levels)) throw new Error('Invalid paper fill inputs.');
  let left = quantity, notional = 0;
  const fills = [];
  for (const level of levels) {
    if (left <= 1e-12) break;
    if (!Number.isFinite(level.px) || level.px <= 0 || !Number.isFinite(level.sz) || level.sz <= 0) continue;
    const size = Math.min(left, level.sz); notional += size * level.px; left -= size; fills.push({ px: level.px, qty: size });
  }
  if (left > Math.max(1e-10, quantity * 1e-8)) throw new Error('Visible liquidity cannot fill the joint rebalance. Paper positions are held.');
  return { quantity, notional, price: quantity ? notional / quantity : 0, fills };
}

function applyLeg(account, i, delta, fill) {
  const position = account.positions[i];
  const old = position.qty, next = old + delta;
  const closing = old && Math.sign(old) !== Math.sign(delta) ? Math.min(Math.abs(old), Math.abs(delta)) : 0;
  const realized = closing * Math.sign(old) * (fill.price - position.entry);
  let entry;
  if (Math.abs(next) < 1e-10) entry = 0;
  else if (!old || Math.sign(next) !== Math.sign(old)) entry = fill.price;
  else if (Math.sign(delta) === Math.sign(old)) entry = (Math.abs(old) * position.entry + Math.abs(delta) * fill.price) / Math.abs(next);
  else entry = position.entry;
  const fee = fill.notional * PAPER_FEE;
  account.positions[i] = { coin: position.coin, qty: Math.abs(next) < 1e-10 ? 0 : next, entry };
  account.balance += realized - fee; account.realized += realized; account.fees += fee;
  return { coin: position.coin, side: delta > 0 ? 'buy' : 'sell', delta, filledQty: Math.abs(delta), price: fill.price, notional: fill.notional, fee, realized, fills: fill.fills };
}

export function planPaperRebalance(account, choices, market, { snapshotId, now = Date.now() } = {}) {
  if (!Array.isArray(choices) || choices.length !== 4 || choices.some(c => ![-1, 0, 1].includes(c))) throw new Error('A paper proposal must contain one valid choice for all four assets.');
  if (!Array.isArray(market) || market.length !== 4) throw new Error('All four markets are required.');
  for (const [i, m] of market.entries()) {
    if (m.coin !== PAPER_COINS[i] || !m.valid || m.collateralToken !== 0 || !Number.isInteger(m.decimals) || m.decimals < 0 || m.decimals > 8 || !Number.isFinite(m.mark) || m.mark <= 0 || !Number.isFinite(m.oracle) || m.oracle <= 0 || !Number.isFinite(m.funding) || !Number.isFinite(m.bookTime) || !Number.isFinite(m.contextTime) || now - m.bookTime > 15_000 || now - m.contextTime > 60_000 || m.bookTime > now + 10_000 || m.contextTime > now + 10_000 || !m.bids?.length || !m.asks?.length || m.asks[0].px < m.bids[0].px) throw new Error(`${m.coin}: fresh quotes, verified USDC metadata and reference prices are required. Paper positions are held.`);
  }
  const marks = market.map(m => m.mark), initial = accountMetrics(account, marks);
  if (!Number.isFinite(initial.equity) || initial.equity <= 0) throw new Error('Paper equity cannot support a rebalance.');
  // A flat account and flat proposal are a valid zero-cost hold.
  if (account.positions.every(p => !p.qty) && choices.every(c => !c)) return { snapshotId, accountRevision: account.revision, createdAt: now, choices: [...choices], legs: [], next: structuredClone(account), metrics: initial, noChange: true };
  let basis = initial.equity;
  for (let attempt = 0; attempt < 12; attempt++) {
    const next = structuredClone(account), legs = [];
    for (let i = 0; i < 4; i++) {
      const m = market[i], precision = 10 ** m.decimals;
      const target = choices[i] * Math.floor(.2 * basis / m.mark * precision + 1e-9) / precision;
      const delta = target - next.positions[i].qty;
      if (Math.abs(delta) < .5 / precision) continue;
      const fill = consumeBook(delta > 0 ? m.asks : m.bids, Math.abs(delta));
      const mid = (m.bids[0].px + m.asks[0].px) / 2;
      if (Math.abs(fill.price - mid) / mid > .005) throw new Error(`${m.coin}: simulated execution exceeds the fixed 50 bp distance-from-mid limit. Positions are held.`);
      legs.push(applyLeg(next, i, delta, fill));
    }
    const result = accountMetrics(next, marks);
    if (result.equity <= 0) throw new Error('The joint paper rebalance would exhaust equity.');
    // Solve for slots using post-cost equity, rounded down. Risk never expands with swipes.
    const overSlot = next.positions.some((p, i) => Math.abs(p.qty) * marks[i] > .2 * result.equity + 1e-7);
    if (overSlot || result.gross > .8 + 1e-9 || result.availableMargin < -1e-7) { basis = Math.min(basis, result.equity) * (1 - 1e-7); continue; }
    if (!legs.length) return { snapshotId, accountRevision: account.revision, createdAt: now, choices: [...choices], legs: [], next, metrics: result, noChange: true };
    next.revision++;
    const event = { id: `paper-${next.revision}`, at: new Date(now).toISOString(), snapshotId, type: 'rebalance', choices: [...choices], legs, fees: legs.reduce((s, l) => s + l.fee, 0), equity: result.equity, gross: result.gross };
    next.ledger.push(event); next.ledger = next.ledger.slice(-500);
    return { snapshotId, accountRevision: account.revision, createdAt: now, choices: [...choices], legs, next, metrics: result, noChange: !legs.length };
  }
  throw new Error('Lot precision and execution costs cannot meet the fixed portfolio limits. Positions are held.');
}
