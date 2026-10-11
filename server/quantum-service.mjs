import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const BASE = 'https://api.ionq.co/v0.4';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 32_768;
const MARKETS = ['', 'BTC', 'xyz:SP500', 'xyz:BRENTOIL', 'xyz:GOLD'];
const STATES = ['submitted', 'ready', 'started', 'canceled', 'failed', 'completed'];
const GATES = { h: 'single', x: 'single', y: 'single', z: 'single', s: 'single', si: 'single', t: 'single', ti: 'single', rx: 'rotation', ry: 'rotation', rz: 'rotation', cnot: 'controlled', swap: 'pair' };

class APIError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function reply(status, body) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export function executionConfig(env) {
  const backend = env.IONQ_BACKEND || 'simulator';
  const validBackend = ['simulator', 'qpu.forte-1', 'qpu.forte-enterprise-1'].includes(backend);
  const accessReady = typeof env.ALMOND_EXECUTION_TOKEN === 'string' && env.ALMOND_EXECUTION_TOKEN.length >= 32;
  const providerReady = Boolean(env.IONQ_API_KEY?.trim());
  const hardwareEnabled = backend === 'simulator' || env.ALMOND_ALLOW_QPU === 'true';
  return { ready: validBackend && accessReady && providerReady && hardwareEnabled, backend, provider: 'IonQ', maxQubits: 8, maxGates: 256, maxShots: 4096, mode: backend === 'simulator' ? 'cloud-simulator' : 'quantum-hardware', requiresAccessCode: true };
}

function authenticate(request, env) {
  const expected = env.ALMOND_EXECUTION_TOKEN;
  const supplied = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
  const digest = value => createHash('sha256').update(value).digest();
  if (!expected || !timingSafeEqual(digest(supplied), digest(expected))) throw new APIError(401, 'access_denied', 'The execution access code is missing or incorrect.');
  // No cross-origin browser invocation; the API is used by its own frontend.
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new APIError(403, 'origin_denied', 'Use the circuit runner on this site.');
}

export function validateCircuit(raw) {
  if (!raw || Array.isArray(raw) || typeof raw !== 'object' || raw.gateset !== 'qis' || !Number.isInteger(raw.qubits) || raw.qubits < 1 || raw.qubits > 8 || !Array.isArray(raw.circuit) || raw.circuit.length < 1 || raw.circuit.length > 256) {
    throw new APIError(400, 'invalid_circuit', 'Use a QIS JSON circuit with 1–8 qubits and 1–256 gates.');
  }
  const index = value => Number.isInteger(value) && value >= 0 && value < raw.qubits;
  const circuit = raw.circuit.map((entry, offset) => {
    if (!entry || typeof entry !== 'object' || !Object.hasOwn(GATES, entry.gate)) throw new APIError(400, 'invalid_gate', `Gate ${offset + 1} is unsupported. Use h, x, y, z, s, si, t, ti, rx, ry, rz, cnot, or swap.`);
    const kind = GATES[entry.gate];
    const allowed = kind === 'controlled' ? ['gate', 'target', 'control'] : kind === 'pair' ? ['gate', 'targets'] : kind === 'rotation' ? ['gate', 'target', 'rotation'] : ['gate', 'target'];
    if (Object.keys(entry).some(key => !allowed.includes(key)) || (kind !== 'pair' && !index(entry.target)) || (kind === 'controlled' && (!index(entry.control) || entry.control === entry.target)) || (kind === 'pair' && (!Array.isArray(entry.targets) || entry.targets.length !== 2 || !entry.targets.every(index) || entry.targets[0] === entry.targets[1])) || (kind === 'rotation' && (!Number.isFinite(entry.rotation) || Math.abs(entry.rotation) > Math.PI * 100))) {
      throw new APIError(400, 'invalid_gate', `Gate ${offset + 1} has invalid qubit indices, parameters, or fields.`);
    }
    return Object.fromEntries(allowed.map(key => [key, entry[key]]));
  });
  return { gateset: 'qis', qubits: raw.qubits, circuit };
}

export function signReceipt(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${createHmac('sha256', secret).update(encoded).digest('base64url')}`;
}

export function readReceipt(receipt, secret, now = Date.now()) {
  if (typeof receipt !== 'string' || receipt.length > 4096) throw new APIError(400, 'invalid_receipt', 'The job receipt is invalid.');
  const [encoded, signature, extra] = receipt.split('.');
  const expected = createHmac('sha256', secret).update(encoded || '').digest('base64url');
  if (extra || !signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new APIError(403, 'invalid_receipt', 'The job receipt could not be verified.');
  let data;
  try { data = JSON.parse(Buffer.from(encoded, 'base64url').toString()); } catch { throw new APIError(400, 'invalid_receipt', 'The job receipt is invalid.'); }
  if (!UUID.test(data.id || '') || !Number.isFinite(data.createdAt) || now - data.createdAt > 86_400_000 || data.createdAt > now + 60_000) throw new APIError(403, 'expired_receipt', 'The job receipt expired. Retrieve older jobs through your IonQ account.');
  return data;
}

async function provider(path, options, key, fetcher) {
  let response;
  try {
    response = await fetcher(`${BASE}${path}`, { ...options, headers: { Authorization: `apiKey ${key}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15_000), redirect: 'error' });
  } catch {
    throw new APIError(504, options.method === 'POST' ? 'submission_uncertain' : 'provider_unreachable', options.method === 'POST' ? 'Submission could not be confirmed. Check your IonQ dashboard before submitting again; a job may already exist.' : 'The quantum provider could not be reached. Resume updates to check this job again.');
  }
  if (!response.ok) {
    // Never relay provider error bodies; they may contain account data or credentials.
    if (response.status === 401 || response.status === 403) throw new APIError(502, 'provider_credentials', 'The server’s IonQ credentials lack access. The project owner needs to check provider access.');
    if (response.status === 429) throw new APIError(429, 'provider_rate_limit', 'IonQ is rate limiting requests. Wait before retrying.');
    if (response.status === 404) throw new APIError(404, 'provider_not_found', 'The requested provider job or result artifact was not found.');
    throw new APIError(502, options.method === 'POST' && response.status >= 500 ? 'submission_uncertain' : 'provider_rejected', options.method === 'POST' && response.status >= 500 ? 'Submission could not be confirmed. Check your IonQ dashboard before submitting again.' : 'IonQ rejected the request. Check the circuit and provider account before retrying.');
  }
  try { return await response.json(); } catch { throw new APIError(502, options.method === 'POST' ? 'submission_uncertain' : 'invalid_provider_response', 'The provider returned an unreadable response. Check your IonQ dashboard before submitting again.'); }
}

function publicJob(job, receipt) {
  return {
    id: job.id, status: STATES.includes(job.status) ? job.status : 'unknown', backend: job.backend || receipt.backend,
    submittedAt: job.submitted_at || new Date(receipt.createdAt).toISOString(), startedAt: job.started_at || null, completedAt: job.completed_at || null,
    providerExecutionMs: Number.isFinite(job.execution_duration_ms) ? job.execution_duration_ms : null,
    circuit: { qubits: receipt.qubits, gates: receipt.gates, sha256: receipt.circuitHash }, shots: receipt.shots, market: receipt.market,
    runId: receipt.runId, failure: job.status === 'failed' ? 'IonQ reported that this job failed. Inspect the provider dashboard for details.' : null,
  };
}

export async function handleQuantum(request, { env = process.env, fetcher = globalThis.fetch, now = Date.now } = {}) {
  const config = executionConfig(env);
  if (request.method === 'GET') return reply(200, { ...config, note: config.ready ? 'Server settings are present. Provider access is verified when you submit a job. The ideal simulator returns probabilities; requested shots are not sampled.' : 'Quantum execution needs server-side IonQ credentials and an execution access code. Qollab credits require separately confirmed API access.' });
  if (request.method !== 'POST') return reply(405, { error: 'method_not_allowed', message: 'Use GET for setup status or POST for job actions.' });
  try {
    if (!config.ready) throw new APIError(503, 'setup_required', 'Live execution is not configured. The project owner needs to connect provider API access in Vercel.');
    authenticate(request, env);
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new APIError(415, 'json_required', 'Send an application/json request.');
    const length = Number(request.headers.get('content-length') || 0);
    if (length > MAX_BYTES) throw new APIError(413, 'payload_too_large', 'The circuit request exceeds 32 KB.');
    const text = await request.text();
    if (Buffer.byteLength(text) > MAX_BYTES) throw new APIError(413, 'payload_too_large', 'The circuit request exceeds 32 KB.');
    let body;
    try { body = JSON.parse(text); } catch { throw new APIError(400, 'invalid_json', 'The circuit request is not valid JSON.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new APIError(400, 'invalid_json', 'The circuit request must be an object.');
    if (body.action === 'submit') {
      const input = validateCircuit(body.circuit);
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > 80 || !Number.isInteger(body.shots) || body.shots < 1 || body.shots > config.maxShots || !MARKETS.includes(body.market || '')) throw new APIError(400, 'invalid_parameters', 'Provide a name up to 80 characters, 1–4096 shots, and one of Almond’s supported markets.');
      const createdAt = now(), runId = randomUUID();
      const receiptData = { createdAt, runId, backend: config.backend, qubits: input.qubits, gates: input.circuit.length, shots: body.shots, market: body.market || '', circuitHash: createHash('sha256').update(JSON.stringify(input)).digest('hex') };
      const created = await provider('/jobs', { method: 'POST', body: JSON.stringify({ type: 'ionq.circuit.v1', backend: config.backend, name: `Almond · ${name}`, shots: body.shots, input, metadata: { almond_run_id: runId, almond_circuit_sha256: receiptData.circuitHash, almond_market: receiptData.market } }) }, env.IONQ_API_KEY, fetcher);
      if (!UUID.test(created.id || '')) throw new APIError(502, 'submission_uncertain', 'IonQ did not return a valid job ID. Check the provider dashboard before retrying.');
      receiptData.id = created.id;
      return reply(202, { job: publicJob(created, receiptData), receipt: signReceipt(receiptData, env.ALMOND_EXECUTION_TOKEN) });
    }
    if (body.action === 'status') {
      const receipt = readReceipt(body.receipt, env.ALMOND_EXECUTION_TOKEN, now());
      const job = await provider(`/jobs/${receipt.id}`, { method: 'GET' }, env.IONQ_API_KEY, fetcher);
      if (job.id !== receipt.id) throw new APIError(502, 'invalid_provider_response', 'The provider returned an unexpected job.');
      const output = { job: publicJob(job, receipt), results: null, resultFormat: null, resultsNote: '' };
      if (job.status === 'completed') {
        const descriptor = job.results?.['ionq.result.probabilities.json.v2'];
        if (descriptor && UUID.test(descriptor.id || '')) {
          output.results = await provider(`/jobs/${receipt.id}/artifacts/${descriptor.id}`, { method: 'GET' }, env.IONQ_API_KEY, fetcher);
          output.resultFormat = 'ionq.result.probabilities.json.v2';
        } else output.resultsNote = 'The job completed but a supported probability artifact is not yet available. Resume updates or inspect the provider dashboard.';
      }
      return reply(200, output);
    }
    throw new APIError(400, 'invalid_action', 'Choose submit or status.');
  } catch (error) {
    if (error instanceof APIError) return reply(error.status, { error: error.code, message: error.message });
    return reply(500, { error: 'internal_error', message: 'The execution service could not process the request.' });
  }
}
