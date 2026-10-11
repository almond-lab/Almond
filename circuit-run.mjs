/** Actual worker telemetry; animation depicts the stage, never a hardware job. */
export class CircuitRun {
  constructor() {
    this.root = document.createElement('section');
    this.root.className = 'circuit-run'; this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Local quantum circuit execution');
    this.root.innerHTML = `<div class="run-heading"><div><p class="eyebrow">LIVE CIRCUIT / LOCAL CPU SIMULATOR</p><h2>Inside your optimization.</h2></div><div class="run-actions"><span class="run-badge">Ready</span><button class="run-replay text-button" type="button" hidden>Replay circuit ↻</button></div></div><p class="run-status" role="status"></p><div class="run-diagram"></div><div class="run-footer"><progress max="100" value="0" aria-label="Optimization progress"></progress><span class="run-budget"></span></div><details class="run-console"><summary>Execution console</summary><pre tabindex="0" aria-label="Execution log"></pre></details>`;
    document.querySelector('#optimization-workspace').append(this.root);
    this.rows = []; this.replayTimers = [];
    this.root.querySelector('.run-replay').addEventListener('click', () => this.replay());
    this.root.querySelector('.run-diagram').innerHTML = `<svg viewBox="0 0 720 272" role="img" aria-label="Eight-qubit QAOA circuit: Hadamard preparation, cost phase, mixer, repeated layers and measurement">${['H','Rz / Rzz','Rx','× layers','M'].map((label,i)=>`<text x="${140+i*125}" y="18" text-anchor="middle" class="run-column-label">${label}</text>`).join('')}${Array.from({length:8},(_,q)=>`<text x="8" y="${48+q*30}" class="run-wire-label">${['BTC','SP500','Brent','Gold'][Math.floor(q/2)]} ${q%2?'short':'long'}</text><line x1="105" x2="695" y1="${44+q*30}" y2="${44+q*30}"/>${['prepare','retune','retune','retune','sample'].map((stage,i)=>`<rect data-stage="${stage}" x="${123+i*125}" y="${33+q*30}" width="34" height="22" rx="5"/><text x="${140+i*125}" y="${48+q*30}" text-anchor="middle">${['H','Z','X','↻','M'][i]}</text>`).join('')}`).join('')}</svg>`;
  }
  start(snapshot, warm, trigger) {
    this.resetReplay(); this.root.querySelector('.run-replay').hidden = true;
    this.id = snapshot.id; this.started = performance.now(); this.rows = [];
    this.root.hidden = false; this.root.dataset.running = 'true';
    this.root.querySelector('progress').value = 0;
    this.root.querySelector('.run-badge').textContent = 'Running';
    this.root.querySelector('.run-budget').textContent = `${snapshot.settings.evaluationBudget} evaluations · ${snapshot.settings.localShots} shots`;
    this.log(`Snapshot ${snapshot.id} · v${snapshot.version} · trigger: ${trigger}`);
    this.log(`${warm ? 'Warm start: previous angles' : 'Initial angles'} · ${snapshot.settings.layers} QAOA layers · 8 qubits / 256 amplitudes`);
    this.status('Frozen inputs queued for local state-vector simulation.');
    this.activate('prepare');
    if (trigger === 'manual') this.root.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',block:'start'});
  }
  status(message) { this.root.querySelector('.run-status').textContent = message; }
  log(message, elapsed = performance.now()-this.started) {
    this.rows.push(`[${(elapsed/1000).toFixed(3)}s] ${message}`);
    const pre = this.root.querySelector('pre'); pre.textContent = this.rows.join('\n'); pre.scrollTop = pre.scrollHeight;
  }
  activate(stage) { this.root.querySelectorAll('[data-stage]').forEach(g=>g.classList.toggle('active',g.dataset.stage===stage)); }
  progress(event) {
    this.root.querySelector('progress').value = event.percent;
    this.status(event.message); this.activate(event.stage); this.log(event.message, event.elapsedMs);
  }
  finish(result) {
    this.root.dataset.running = 'false'; this.root.querySelector('progress').value = 100;
    this.root.querySelector('.run-replay').hidden = false;
    this.root.querySelector('.run-badge').textContent = 'Completed'; this.activate('sample');
    this.status(`Completed in ${result.timing.totalMs.toFixed(1)} ms · ${result.metrics.evaluations} evaluations · ${result.resources.shots} sampled shots. Automatic paper rebalance follows.`);
    this.log(`Completed · feasible sampled target: ${result.selected ? 'yes' : 'none'} · exact optimum gap: ${result.gap ?? 'unavailable'}`,result.timing.totalMs);
    this.root.querySelector('.run-budget').textContent = 'Local classical simulation · no QPU job';
  }
  resetReplay() {
    this.replayTimers.forEach(clearTimeout); this.replayTimers = []; this.root.dataset.replay = 'false';
  }
  replay() {
    this.resetReplay(); this.root.dataset.replay = 'true';
    this.root.querySelector('.run-badge').textContent = 'Completed · visual replay';
    // Slow schematic replay is separate from the already-completed CPU solve.
    ['prepare','retune','retune','sample'].forEach((stage,i)=>this.replayTimers.push(setTimeout(()=>this.activate(stage),i*700)));
    this.replayTimers.push(setTimeout(()=>{this.resetReplay();this.root.querySelector('.run-badge').textContent='Completed';},2800));
  }
  stop(message) {
    this.resetReplay(); this.root.querySelector('.run-replay').hidden = true;
    if (this.root.hidden) return;
    this.root.dataset.running = 'false'; this.root.querySelector('.run-badge').textContent = 'Stopped';
    this.status(message); this.log(message); this.activate('none');
  }
}
