const $ = id => document.getElementById(id);
const bell = { qubits: 2, gateset: 'qis', circuit: [{ gate: 'h', target: 0 }, { gate: 'cnot', control: 0, target: 1 }] };
const storageKey = 'almond.quantum.last-job.v1';
let config = { ready: false };
let current = null;
let pollingTimer;
let pollGeneration = 0;
let pending = false;
let paused = true;
let submissionUncertain = false;
let elapsedTimer;

function message(id, text) { if ($(id).textContent !== text) $(id).textContent = text; }

async function api(payload, timeout = 25_000) {
  const options = { headers: {}, signal: AbortSignal.timeout(timeout) };
  if (payload) {
    options.method = 'POST';
    options.headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${$('execution-access').value}` };
    options.body = JSON.stringify(payload);
  }
  let response;
  try { response = await fetch('/api/quantum', options); }
  catch {
    const error = new Error(payload?.action === 'submit' ? 'Submission could not be confirmed. Check your IonQ dashboard before submitting again; a job may already exist.' : 'The execution service could not be reached. Resume updates to retry.');
    error.code = payload?.action === 'submit' ? 'submission_uncertain' : 'network_error';
    throw error;
  }
  let data;
  try { data = await response.json(); }
  catch {
    const error = new Error('The execution service returned an unreadable response. Check the provider dashboard before submitting again.');
    error.code = payload?.action === 'submit' ? 'submission_uncertain' : 'invalid_response';
    throw error;
  }
  if (!response.ok) { const error = new Error(data.message || 'The job request failed.'); error.code = data.error; throw error; }
  return data;
}

function activeJob() { return current?.job && ['submitted', 'ready', 'started', 'unknown'].includes(current.job.status); }

function updateControls() {
  $('run-circuit').disabled = !config.ready || pending || activeJob() || submissionUncertain;
  $('run-circuit').textContent = pending ? 'Submitting…' : 'Run circuit';
  $('resume-job').disabled = !current?.receipt || pending || !config.ready || !paused;
  $('stop-polling').disabled = paused;
  $('download-job').disabled = !current?.job;
  $('job-status').dataset.state = current?.job?.status || 'idle';
}

function updateElapsed() {
  const submitted = Date.parse(current?.job?.submittedAt);
  if (!Number.isFinite(submitted)) { $('job-elapsed').textContent = '—'; return; }
  const end = current.observedCompletedAt || Date.now();
  $('job-elapsed').textContent = `${Math.max(0, (end - submitted) / 1000).toFixed(1)} s`;
}

function renderJob() {
  if (!current?.job) return;
  const job = current.job;
  const statuses = { submitted: 'Submitted', ready: 'Queued', started: 'Running', completed: 'Completed', failed: 'Failed', canceled: 'Canceled', unknown: 'Status unavailable' };
  message('job-status', `${statuses[job.status] || 'Status unavailable'}${paused && activeJob() ? ' · updates paused' : ''}`);
  $('job-id').textContent = job.id;
  $('job-submitted').textContent = job.submittedAt ? new Date(job.submittedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }) : '—';
  $('job-provider-time').textContent = Number.isFinite(job.providerExecutionMs) ? `${job.providerExecutionMs.toLocaleString()} ms` : 'Not yet reported';
  $('job-circuit-summary').textContent = `${job.circuit.qubits} qubits · ${job.circuit.gates} gates · ${job.backend} · ${job.shots} requested shots${job.market ? ` · ${job.market} context` : ''}`;
  $('job-results').textContent = current.results !== null && current.results !== undefined ? JSON.stringify(current.results, null, 2) : current.resultsNote || job.failure || (job.status === 'completed' ? 'Job completed. The probability artifact has not been retrieved yet.' : 'Results appear here after the provider completes the job.');
  updateElapsed();
  updateControls();
}

function persistJob() {
  try { sessionStorage.setItem(storageKey, JSON.stringify(current)); } catch { /* Continue with a memory-only job. */ }
}

function pauseUpdates(announce = true) {
  clearTimeout(pollingTimer);
  pollGeneration++;
  paused = true;
  if (announce) message('run-message', 'Updates paused. This does not cancel the quantum job; resume to retrieve its latest status.');
  renderJob();
  updateControls();
}

async function poll(generation, errors = 0) {
  if (generation !== pollGeneration || paused || !current?.receipt) return;
  try {
    const result = await api({ action: 'status', receipt: current.receipt });
    if (generation !== pollGeneration) return;
    current = { ...current, ...result };
    if (['completed', 'failed', 'canceled'].includes(result.job.status)) {
      current.observedCompletedAt ||= Date.now();
      paused = true;
    }
    persistJob();
    renderJob();
    message('run-message', result.job.status === 'completed' ? 'Provider execution completed. Results and timing are available below.' : result.job.failure || `Job ${result.job.status}. Checking for updates…`);
    if (!paused) pollingTimer = setTimeout(() => poll(generation), 4_000);
  } catch (error) {
    if (generation !== pollGeneration) return;
    message('run-message', error.message);
    if (['access_denied', 'invalid_receipt', 'expired_receipt', 'setup_required', 'provider_credentials'].includes(error.code) || errors >= 3) {
      paused = true;
      renderJob();
    } else pollingTimer = setTimeout(() => poll(generation, errors + 1), Math.min(20_000, 4_000 * 2 ** errors));
    updateControls();
  }
}

function resumeUpdates() {
  if (!current?.receipt || !$('execution-access').value) { message('run-message', 'Enter the project execution access code to check this job.'); return; }
  paused = false;
  const generation = ++pollGeneration;
  clearTimeout(pollingTimer);
  updateControls();
  poll(generation);
}

async function checkExecution() {
  $('check-execution').disabled = true;
  try {
    config = await api();
    $('execution-status').dataset.state = config.ready ? 'ready' : 'setup';
    message('execution-status', config.ready ? 'Execution configured' : 'Provider setup required');
    message('execution-note', config.note);
    $('backend-name').textContent = `${config.provider} · ${config.backend}${config.mode === 'cloud-simulator' ? ' · cloud simulator' : ' · quantum hardware'}`;
  } catch (error) {
    config = { ready: false };
    message('execution-status', 'Execution service unavailable');
    message('execution-note', error.message);
  } finally { $('check-execution').disabled = false; updateControls(); }
}

$('circuit-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!config.ready || pending || activeJob() || submissionUncertain) return;
  if (!$('execution-access').value) { message('run-message', 'Enter the project execution access code. Your IonQ API key belongs in Vercel’s server settings.'); return; }
  let circuit;
  try { circuit = JSON.parse($('circuit-json').value); }
  catch { message('run-message', 'The circuit editor contains invalid JSON. Fix the syntax before running.'); return; }
  pending = true;
  pauseUpdates(false);
  updateControls();
  message('run-message', 'Submitting the circuit to the configured provider…');
  try {
    const result = await api({ action: 'submit', name: $('circuit-name').value, shots: Number($('run-shots').value), market: $('run-market').value, circuit });
    current = { ...result, results: null, observedCompletedAt: null, submittedCircuit: circuit };
    persistJob();
    renderJob();
    message('run-message', 'Job accepted. Waiting for the provider’s first status update…');
  } catch (error) {
    if (error.code === 'submission_uncertain') submissionUncertain = true;
    message('run-message', error.message);
  } finally {
    pending = false;
    updateControls();
    if (current?.receipt && activeJob() && !submissionUncertain) resumeUpdates();
  }
});
$('load-bell').addEventListener('click', () => {
  $('circuit-json').value = JSON.stringify(bell, null, 2);
  $('circuit-name').value = 'Bell connection test';
  message('run-message', 'Bell circuit loaded. It tests the execution connection; it is not a trading strategy.');
});
$('check-execution').addEventListener('click', checkExecution);
$('resume-job').addEventListener('click', resumeUpdates);
$('stop-polling').addEventListener('click', () => pauseUpdates());
$('download-job').addEventListener('click', () => {
  if (!current?.job) return;
  // Exports omit access codes and signed receipts.
  const output = { schema: 'almond.quantum.execution.v1', exportedAt: new Date().toISOString(), provider: 'IonQ', job: current.job, submittedCircuit: current.submittedCircuit || null, results: current.results, resultFormat: current.resultFormat || null, observedCompletedAt: current.observedCompletedAt ? new Date(current.observedCompletedAt).toISOString() : null, timingNote: 'Browser-observed elapsed time includes queueing, network traffic, and polling; it does not establish a quantum speedup or strategy decision latency.' };
  const url = URL.createObjectURL(new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `almond-job-${current.job.id}.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
});
try {
  const saved = sessionStorage.getItem(storageKey);
  if (saved) {
    const result = JSON.parse(saved);
    if (typeof result.receipt === 'string' && typeof result.job?.id === 'string' && result.job?.circuit && typeof result.job.submittedAt === 'string') {
      current = result;
      renderJob();
      message('run-message', 'Your last job is restored in this tab. Enter the access code and resume updates to check it.');
    }
  }
} catch { /* Ignore invalid browser-local saved state. */ }
elapsedTimer = setInterval(updateElapsed, 1_000);
checkExecution();
window.addEventListener('pagehide', () => { pauseUpdates(false); clearInterval(elapsedTimer); $('execution-access').value = ''; });
window.addEventListener('pageshow', event => { if (event.persisted) { elapsedTimer = setInterval(updateElapsed, 1_000); checkExecution(); } });
