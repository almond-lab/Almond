import * as portfolio from 'portfolio';

// Qollab injects backend. Async Python calls are required for IonQ networking.
const el = id => document.getElementById(id);
const number = value => value == null ? '—' : Number(value).toFixed(6);
const names = ['BTC / USDC', 'S&P 500 / USDC', 'BRENT / USDC', 'GOLD / USDC'];
const direction = value => value > 0 ? 'LONG' : value < 0 ? 'SHORT' : 'FLAT';
try {
  const raw = await portfolio.run_portfolio.callPromising(backend, 1024);
  const report = JSON.parse(typeof raw === 'string' ? raw : raw.toJs());
  el('sampled').textContent = number(report.selected?.cost);
  el('exact').textContent = number(report.exact.cost);
  el('gap').textContent = number(report.gap);
  el('feasible').textContent = `${(report.metrics.feasibleRate * 100).toFixed(1)}%`;
  el('status').textContent = `${report.metrics.returnedShots.toLocaleString()} shots returned · Snapshot ${report.snapshotId} · v${report.snapshotVersion}`;
  el('hold').textContent = report.holdComparison.eligible ? 'Eligible for paper-account review' : 'Hold current positions';
  names.forEach((name, index) => {
    const card = document.createElement('article');
    const title = document.createElement('small'); title.textContent = name;
    const value = report.selected?.choices[index];
    const label = document.createElement('strong'); label.textContent = value == null ? 'HOLD' : direction(value);
    const weight = document.createElement('span');
    weight.textContent = value == null ? 'No feasible sampled proposal' : `${(report.selected.breakdown.weights[index] * 100).toFixed(0)}% proposed equity weight`;
    card.append(title, label, weight); el('portfolio').append(card);
  });
  report.distribution.filter(row => row.feasible).sort((a,b) => b.count-a.count).slice(0,8).forEach(row => {
    const item = document.createElement('div'); item.className = 'bar-row';
    const label = document.createElement('span'); label.textContent = row.choices.map(direction).join(' / ');
    const value = document.createElement('small'); value.textContent = `${(row.frequency*100).toFixed(1)}% · cost ${number(row.cost)}`;
    const bar = document.createElement('div'); bar.className = 'bar'; bar.style.width = `${row.frequency*100}%`;
    item.append(label, value, bar); el('distribution').append(item);
  });
  el('record').textContent = JSON.stringify(report, null, 2);
  el('provenance').textContent = `${report.syntheticInputs ? 'Synthetic teaching inputs' : 'Uploaded frozen inputs'} · ${report.executionMode} · one submission · no automatic trading`;
} catch (error) {
  el('status').textContent = `Run failed: ${error.message ?? String(error)}. No retry or replacement backend was submitted.`;
  console.error(error);
}
