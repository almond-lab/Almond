'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const sizeInput = $('problem-size');
  const targetInput = $('success-target');
  const overheadInput = $('overhead');
  const svg = $('benchmark-chart');
  const container = $('chart-container');
  const tooltip = $('chart-tooltip');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const motionButton = $('motion-toggle');
  const heroArt = document.querySelector('.hero-art');
  let motionPaused = reducedMotion.matches;
  let sweepTimer = null;
  const superscripts = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  const superscript = n => String(n).split('').map(x => superscripts[Number(x)]).join('');
  const formatNumber = n => new Intl.NumberFormat('en-US').format(n);
  const compact = n => n >= 1e9 ? `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : `${Math.round(n)}`;
  const time = n => n >= 3600 ? `${(n / 3600).toFixed(2)} h` : n >= 60 ? `${(n / 60).toFixed(2)} min` : n >= 1 ? `${n.toFixed(2)} s` : n >= .001 ? `${(n * 1000).toFixed(2)} ms` : `${(n * 1e6).toFixed(1)} μs`;
  const timing = { classicalQuerySeconds: .000001, quantumIterationSeconds: .00008, verificationSeconds: .000001, classicalFixedSeconds: .002, quantumFixedSeconds: .04 };
  let state;
  let chartPoints = [];
  let chartDimensions = { width: 760, left: 68, right: 25 };
  let hideTimer;
  function model(exponent, target, metric, overhead) {
    const n = 2 ** exponent;
    const theta = Math.asin(1 / Math.sqrt(n));
    const iterations = Math.max(0, Math.round(Math.PI / (4 * theta) - .5));
    const success = Math.min(1, Math.sin((2 * iterations + 1) * theta) ** 2);
    const repetitions = success >= 1 ? 1 : Math.max(1, Math.ceil(Math.log1p(-target) / Math.log1p(-success)));
    const classicalQueries = Math.ceil(target * n);
    const quantumQueries = (iterations + 1) * repetitions;
    const classicalSeconds = classicalQueries * timing.classicalQuerySeconds + (overhead ? timing.classicalFixedSeconds : 0);
    const quantumSeconds = repetitions * (iterations * timing.quantumIterationSeconds + timing.verificationSeconds) + (overhead ? timing.quantumFixedSeconds : 0);
    return { exponent, n, theta, iterations, success, repetitions, classicalQueries, quantumQueries, classicalSeconds, quantumSeconds, classical: metric === 'queries' ? classicalQueries : classicalSeconds, quantum: metric === 'queries' ? quantumQueries : quantumSeconds };
  }
  function renderChart() {
    const small = container.clientWidth < 500;
    const W = small ? Math.max(240, container.clientWidth) : 760, H = small ? 300 : 330, left = 68, right = small ? 17 : 25, top = 26, bottom = 36;
    chartDimensions = { width: W, left, right };
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const points = Array.from({ length: 23 }, (_, i) => model(i + 8, state.target, state.metric, state.overhead));
    chartPoints = points;
    const minLog = Math.floor(Math.log10(Math.min(...points.flatMap(p => [p.classical, p.quantum]))));
    const maxLog = Math.ceil(Math.log10(Math.max(...points.flatMap(p => [p.classical, p.quantum]))));
    const x = e => left + (e - 8) / 22 * (W - left - right);
    const y = v => top + (maxLog - Math.log10(v)) / (maxLog - minLog) * (H - top - bottom);
    const path = key => points.map((p, i) => `${i ? 'L' : 'M'} ${x(p.exponent).toFixed(2)} ${y(p[key]).toFixed(2)}`).join(' ');
    const axisLabel = v => state.metric === 'queries' ? compact(v) : v >= 1 ? (v < 60 ? `${v}s` : time(v)) : v >= .001 ? `${+(v * 1000).toFixed(2)}ms` : `${+(v * 1e6).toFixed(2)}μs`;
    const current = model(state.exponent, state.target, state.metric, state.overhead);
    let grid = '';
    for (let power = minLog; power <= maxLog; power++) {
      const yy = y(10 ** power);
      grid += `<line x1="${left}" x2="${W-right}" y1="${yy}" y2="${yy}" stroke="#292725" stroke-width="1"/><text x="${left-12}" y="${yy+3}" fill="#9a958e" font-size="12" text-anchor="end">${axisLabel(10 ** power)}</text>`;
    }
    const ticks = (small ? [8, 16, 24, 30] : [8, 12, 16, 20, 24, 28, 30]).map(e => `<text x="${x(e)}" y="${H-11}" fill="#9a958e" font-size="12" text-anchor="middle">2${superscript(e)}</text>`).join('');
    svg.innerHTML = `<desc id="chart-description">${state.metric === 'queries' ? 'Oracle query budgets' : 'Illustrative workload time'} on a logarithmic scale from 2 to the eighth to 2 to the thirtieth candidate states. Classical resources grow linearly, while Grover resources grow approximately with the square root. Current classical value ${state.metric === 'queries' ? formatNumber(current.classical) + ' queries' : time(current.classical)}; quantum ${state.metric === 'queries' ? formatNumber(current.quantum) + ' queries' : time(current.quantum)}.</desc><defs><linearGradient id="quantum-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#ff8a3d" stop-opacity=".07"/><stop offset="100%" stop-color="#ff8a3d" stop-opacity="0"/></linearGradient></defs>${grid}${ticks}<path d="${path('quantum')} L ${x(30)} ${H-bottom} L ${x(8)} ${H-bottom} Z" fill="url(#quantum-fill)"/><path d="${path('classical')}" fill="none" stroke="#b6b6b9" stroke-width="2" stroke-linecap="round"/><path d="${path('quantum')}" fill="none" stroke="#ff8a3d" stroke-width="2.5" stroke-linecap="round"/><line x1="${x(state.exponent)}" x2="${x(state.exponent)}" y1="${top-5}" y2="${H-bottom}" stroke="#75604d" stroke-width="1" stroke-dasharray="3 5"/><rect x="${x(state.exponent)-20}" y="${top-17}" width="40" height="15" rx="3" fill="#28211b"/><text x="${x(state.exponent)}" y="${top-7}" fill="#ffb887" font-size="${small ? 12 : 10}" text-anchor="middle">N = 2${superscript(state.exponent)}</text><circle cx="${x(state.exponent)}" cy="${y(current.classical)}" r="5" fill="#b6b6b9" stroke="#111113" stroke-width="3"/><circle cx="${x(state.exponent)}" cy="${y(current.quantum)}" r="5.5" fill="#ff8a3d" stroke="#111113" stroke-width="3"/>`;
  }
  function update() {
    state = { exponent: Number(sizeInput.value), target: Number(targetInput.value), metric: document.querySelector('input[name="metric"]:checked').value, overhead: overheadInput.checked };
    const data = model(state.exponent, state.target, state.metric, state.overhead);
    const isQueries = state.metric === 'queries';
    overheadInput.disabled = isQueries;
    $('size-value').textContent = `2${superscript(state.exponent)}`;
    $('size-detail').textContent = `${formatNumber(data.n)} candidate states`;
    sizeInput.setAttribute('aria-valuetext', `${formatNumber(data.n)} candidate states, 2 to the power ${state.exponent}`);
    $('chart-title').textContent = isQueries ? 'Oracle query complexity' : 'Illustrative workload time';
    $('chart-subtitle').textContent = isQueries ? 'Resource budget at a matched success threshold' : `${state.overhead ? 'Fixed overhead included' : 'Execution + verification only'} · synthetic model`;
    const setResult = (id, value) => {
      const el = $(id);
      const numeric = isQueries ? formatNumber(value) : time(value);
      el.replaceChildren(document.createTextNode(numeric));
      if (isQueries) { const small = document.createElement('small'); small.textContent = ' queries'; el.append(small); }
    };
    setResult('classical-result', data.classical);
    setResult('quantum-result', data.quantum);
    $('classical-detail').textContent = isQueries ? 'Random search, without replacement' : '1 μs / query' + (state.overhead ? ' + 2 ms overhead' : '');
    $('quantum-detail').textContent = isQueries ? 'Iterations + verification, across runs' : '80 μs / iteration' + (state.overhead ? ' + 40 ms overhead' : '');
    const ratio = data.classical / data.quantum;
    const quantumBetter = ratio >= 1;
    $('ratio-label').textContent = isQueries ? 'QUERY REDUCTION' : quantumBetter ? 'MODELED TIME RATIO' : 'CLASSICAL TIME ADVANTAGE';
    $('ratio-result').textContent = `${new Intl.NumberFormat('en-US', { maximumFractionDigits: ratio > 100 ? 0 : 2 }).format(quantumBetter ? ratio : 1/ratio)}×`;
    $('ratio-detail').textContent = isQueries ? 'Theoretical, not a measured speedup' : quantumBetter ? 'Classical time / quantum time' : 'Quantum time / classical time';
    $('resource-qubits').textContent = `${state.exponent} qubits`;
    $('resource-iterations').textContent = formatNumber(data.iterations);
    $('resource-runs').textContent = data.repetitions;
    $('resource-success').textContent = `${(data.success * 100).toFixed(5)}%`;
    $('model-summary').textContent = isQueries ? 'The classical budget grows with N. Grover\'s oracle count grows with √N.' : quantumBetter ? 'This synthetic model favors quantum at this size. Real hardware costs may change the crossover.' : 'At this size, synthetic quantum costs outweigh the reduction in oracle queries.';
    tooltip.hidden = true;
    renderChart();
    document.querySelectorAll('.preset-button').forEach(button => {
      const selected = Number(button.dataset.exponent) === state.exponent && button.dataset.metric === state.metric && (state.metric !== 'runtime' || state.overhead);
      button.setAttribute('aria-pressed', String(selected));
    });
    if (!motionPaused && !reducedMotion.matches && !sweepTimer) {
      [...svg.querySelectorAll('path')].slice(1).forEach(path => {
        const length = path.getTotalLength();
        path.style.strokeDasharray = String(length);
        const animation = path.animate([{ strokeDashoffset: length }, { strokeDashoffset: 0 }], { duration: 550, easing: 'ease-out' });
        animation.onfinish = () => { path.style.strokeDasharray = ''; };
      });
    }
  }
  function stopScaling(message = 'Scaling animation stopped.') {
    if (sweepTimer === null) return;
    clearInterval(sweepTimer);
    sweepTimer = null;
    document.querySelector('.result-grid').setAttribute('aria-live', 'polite');
    $('sweep-benchmark').textContent = 'Animate scaling ↗';
    $('sweep-benchmark').setAttribute('aria-pressed', 'false');
    $('benchmark-status').textContent = message;
  }
  function changeParameters() { stopScaling(); update(); }
  sizeInput.addEventListener('input', changeParameters);
  targetInput.addEventListener('change', changeParameters);
  overheadInput.addEventListener('change', changeParameters);
  document.querySelectorAll('input[name="metric"]').forEach(input => input.addEventListener('change', changeParameters));
  document.querySelectorAll('.preset-button').forEach(button => button.addEventListener('click', () => {
    stopScaling();
    sizeInput.value = button.dataset.exponent;
    document.querySelector(`input[name="metric"][value="${button.dataset.metric}"]`).checked = true;
    if (button.dataset.metric === 'runtime') overheadInput.checked = true;
    update();
    $('benchmark-status').textContent = `${button.textContent} scenario selected.`;
  }));
  $('sweep-benchmark').addEventListener('click', () => {
    if (sweepTimer !== null) { stopScaling(); return; }
    document.querySelector('.result-grid').setAttribute('aria-live', 'off');
    sizeInput.value = '8';
    update();
    $('sweep-benchmark').textContent = 'Stop animation ■';
    $('sweep-benchmark').setAttribute('aria-pressed', 'true');
    $('benchmark-status').textContent = 'Exploring search-space sizes from 2 to the eighth to 2 to the thirtieth.';
    sweepTimer = window.setInterval(() => {
      sizeInput.value = String(Number(sizeInput.value) + 1);
      update();
      if (Number(sizeInput.value) >= 30) stopScaling('Scaling animation complete. Search space: 2 to the thirtieth.');
    }, 420);
  });
  svg.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    sizeInput.value = String(Math.max(8, Math.min(30, Number(sizeInput.value) + (event.key === 'ArrowRight' ? 1 : -1))));
    changeParameters();
  });
  svg.addEventListener('pointermove', event => {
    const bounds = svg.getBoundingClientRect();
    const viewX = (event.clientX - bounds.left) / bounds.width * chartDimensions.width;
    if (viewX < chartDimensions.left || viewX > chartDimensions.width - chartDimensions.right) { tooltip.hidden = true; return; }
    const exponent = Math.max(8, Math.min(30, Math.round(8 + (viewX - chartDimensions.left) / (chartDimensions.width - chartDimensions.left - chartDimensions.right) * 22)));
    const data = chartPoints[exponent - 8];
    const fmt = state.metric === 'queries' ? v => `${formatNumber(v)} queries` : time;
    tooltip.replaceChildren();
    [ `N = 2${superscript(exponent)} · ${formatNumber(data.n)} states`, `Classical: ${fmt(data.classical)}`, `Quantum: ${fmt(data.quantum)}` ].forEach(line => { const div = document.createElement('div'); div.textContent = line; tooltip.append(div); });
    tooltip.hidden = false;
    const parentBounds = container.getBoundingClientRect();
    const px = event.clientX - parentBounds.left + 12;
    tooltip.style.left = `${Math.max(0, Math.min(px, parentBounds.width - tooltip.offsetWidth - 3))}px`;
    tooltip.style.top = `${Math.max(0, event.clientY - parentBounds.top - tooltip.offsetHeight - 14)}px`;
  });
  svg.addEventListener('pointerleave', () => { tooltip.hidden = true; });
  $('export-data').addEventListener('click', () => {
    const data = model(state.exponent, state.target, state.metric, state.overhead);
    const payload = { project: 'Almond / Qollab hackathon', status: 'Illustrative theoretical and synthetic model; not hardware measurements', algorithm: 'Grover unstructured search; one marked state', parameters: state, result: data, timings: timing, verificationQueriesPerQuantumRun: 1, excludedCosts: ['oracle construction', 'state preparation', 'readout', 'gate decomposition', 'noise', 'error correction', 'network and queue latency'], series: chartPoints, references: ['https://quantum.cloud.ibm.com/learning/en/courses/fundamentals-of-quantum-algorithms/grover-algorithm/number-of-iterations', 'https://www.ionq.com/quantum-benchmarks'] };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `almond-benchmark-n${state.exponent}-${state.metric}.json`; document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('export-status').textContent = 'Comparison exported with parameters and assumptions.';
    clearTimeout(hideTimer); hideTimer = window.setTimeout(() => { $('export-status').textContent = ''; }, 4000);
  });
  let resizeFrame;
  window.addEventListener('resize', () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(renderChart); });
  function syncMotion() {
    document.body.classList.toggle('motion-paused', motionPaused || reducedMotion.matches);
    motionButton.disabled = reducedMotion.matches;
    motionButton.setAttribute('aria-pressed', String(motionPaused || reducedMotion.matches));
    motionButton.textContent = reducedMotion.matches ? 'Reduced motion' : motionPaused ? 'Play motion' : 'Pause motion';
    if (motionPaused || reducedMotion.matches) stopScaling();
  }
  motionButton.addEventListener('click', () => { motionPaused = !motionPaused; syncMotion(); });
  reducedMotion.addEventListener('change', syncMotion);
  heroArt.addEventListener('pointermove', event => {
    if (motionPaused || reducedMotion.matches || event.pointerType === 'touch') return;
    const bounds = heroArt.getBoundingClientRect();
    heroArt.style.setProperty('--pointer-x', `${(event.clientX - bounds.left) / bounds.width * 100}%`);
    heroArt.style.setProperty('--pointer-y', `${(event.clientY - bounds.top) / bounds.height * 100}%`);
  });
  heroArt.addEventListener('pointerleave', () => { heroArt.style.setProperty('--pointer-x', '50%'); heroArt.style.setProperty('--pointer-y', '50%'); });
  new IntersectionObserver(entries => {
    heroArt.classList.toggle('is-offscreen', !entries[0].isIntersecting);
  }).observe(heroArt);
  const revealObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      if (!motionPaused && !reducedMotion.matches) entry.target.animate([{ opacity: .45, transform: 'translateY(18px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 650, easing: 'cubic-bezier(.2,.65,.3,1)' });
      revealObserver.unobserve(entry.target);
    }
  }, { threshold: .08 });
  document.querySelectorAll('.section-heading, .insight, .methodology-intro, .methodology-steps article, .closing').forEach(section => revealObserver.observe(section));
  syncMotion();
  update();
})();
