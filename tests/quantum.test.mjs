import test from 'node:test';
import assert from 'node:assert/strict';
import { executionConfig, handleQuantum, validateCircuit, signReceipt, readReceipt } from '../server/quantum-service.mjs';

const env = { IONQ_API_KEY: 'provider-test-secret', ALMOND_EXECUTION_TOKEN: 'execution-test-secret-that-is-at-least-32-characters' };
const bell = { qubits: 2, gateset: 'qis', circuit: [{ gate: 'h', target: 0 }, { gate: 'cnot', control: 0, target: 1 }] };
const id = '12345678-1234-1234-1234-123456789012';
const artifact = '12345678-1234-1234-1234-123456789013';
const request = (body, token = env.ALMOND_EXECUTION_TOKEN, origin = 'https://almond.test') => new Request('https://almond.test/api/quantum', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Origin: origin }, body: JSON.stringify(body) });
const submission = { action: 'submit', name: 'Connection test', shots: 100, market: 'BTC', circuit: bell };

test('setup requires provider credentials, a strong execution token, and explicit hardware opt-in', async () => {
  assert.equal(executionConfig({}).ready, false);
  assert.equal(executionConfig(env).ready, true);
  assert.equal(executionConfig({ ...env, ALMOND_EXECUTION_TOKEN: 'short' }).ready, false);
  assert.equal(executionConfig({ ...env, IONQ_BACKEND: 'qpu.forte-1' }).ready, false);
  assert.equal(executionConfig({ ...env, IONQ_BACKEND: 'qpu.forte-1', ALMOND_ALLOW_QPU: 'true' }).ready, true);
  const response = await handleQuantum(request(submission), { env: {}, fetcher: () => assert.fail('No provider calls without setup') });
  assert.equal(response.status, 503);
});

test('authentication and cross-origin rejection happen before any provider request', async () => {
  const fetcher = () => assert.fail('No provider call permitted');
  assert.equal((await handleQuantum(request(submission, 'wrong'), { env, fetcher })).status, 401);
  assert.equal((await handleQuantum(request(submission, env.ALMOND_EXECUTION_TOKEN, 'https://other.test'), { env, fetcher })).status, 403);
});

test('bounded circuit validation rejects malformed or unsupported gates', () => {
  assert.deepEqual(validateCircuit(bell), bell);
  assert.throws(() => validateCircuit({ ...bell, qubits: 9 }));
  assert.throws(() => validateCircuit({ ...bell, circuit: [{ gate: '__proto__', target: 0 }] }));
  assert.throws(() => validateCircuit({ ...bell, circuit: [{ gate: 'cnot', control: 0, target: 0 }] }));
  assert.throws(() => validateCircuit({ ...bell, circuit: [{ gate: 'h', target: 2 }] }));
  assert.throws(() => validateCircuit({ ...bell, circuit: [{ gate: 'rx', target: 0, rotation: NaN }] }));
  assert.throws(() => validateCircuit({ ...bell, circuit: [{ gate: 'h', target: 0, controls: [1] }] }));
  assert.throws(() => validateCircuit({ ...bell, circuit: Array.from({ length: 257 }, () => ({ gate: 'h', target: 0 })) }));
});

test('submission uses server target and key, returns a signed receipt, and does not leak secrets', async () => {
  const calls = [];
  const response = await handleQuantum(request({ ...submission, backend: 'qpu.forte-1' }), { env, fetcher: async (url, options) => {
    calls.push({ url, ...options });
    return Response.json({ id, status: 'submitted', session_id: null }, { status: 201 });
  } });
  assert.equal(response.status, 202);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.ionq.co/v0.4/jobs');
  const payload = JSON.parse(calls[0].body);
  assert.equal(payload.backend, 'simulator');
  assert.equal(payload.type, 'ionq.circuit.v1');
  assert.deepEqual(payload.input, bell);
  assert.equal(calls[0].headers.Authorization, `apiKey ${env.IONQ_API_KEY}`);
  const result = await response.json();
  assert.equal(result.job.id, id);
  const receipt = readReceipt(result.receipt, env.ALMOND_EXECUTION_TOKEN);
  assert.equal(receipt.id, id);
  assert.equal(receipt.qubits, 2);
  assert.ok(!JSON.stringify(result).includes(env.IONQ_API_KEY));
  assert.ok(!JSON.stringify(result).includes(env.ALMOND_EXECUTION_TOKEN));
});

test('job receipts reject tampering and expiry and prevent arbitrary account job access', async () => {
  const receipt = signReceipt({ id, createdAt: Date.now() }, env.ALMOND_EXECUTION_TOKEN);
  assert.throws(() => readReceipt('x' + receipt, env.ALMOND_EXECUTION_TOKEN));
  assert.throws(() => readReceipt(receipt, env.ALMOND_EXECUTION_TOKEN, Date.now() + 86_401_000));
  const response = await handleQuantum(request({ action: 'status', receipt: 'forged' }), { env, fetcher: () => assert.fail('Unverified receipt must not reach provider') });
  assert.equal(response.status, 403);
});

test('completed jobs retrieve the documented probability artifact without following provider URLs', async () => {
  const receipt = signReceipt({ id, createdAt: Date.now(), backend: 'simulator', qubits: 2, gates: 2, shots: 100, circuitHash: 'hash', market: '' }, env.ALMOND_EXECUTION_TOKEN);
  const calls = [];
  const response = await handleQuantum(request({ action: 'status', receipt }), { env, fetcher: async url => {
    calls.push(url);
    return Response.json(url.includes('/artifacts/') ? { '0': .5, '3': .5 } : { id, status: 'completed', backend: 'simulator', execution_duration_ms: 25, results: { 'ionq.result.probabilities.json.v2': { id: artifact } }, results_url: 'https://attacker.test' });
  } });
  const result = await response.json();
  assert.equal(result.job.providerExecutionMs, 25);
  assert.deepEqual(result.results, { '0': .5, '3': .5 });
  assert.deepEqual(calls, [`https://api.ionq.co/v0.4/jobs/${id}`, `https://api.ionq.co/v0.4/jobs/${id}/artifacts/${artifact}`]);
});

test('submission transport failures are uncertain and are never automatically retried', async () => {
  let calls = 0;
  const response = await handleQuantum(request(submission), { env, fetcher: async () => { calls++; throw new Error('transport broke'); } });
  assert.equal(response.status, 504);
  assert.equal((await response.json()).error, 'submission_uncertain');
  assert.equal(calls, 1);
});

test('provider errors are sanitized and rejected input never reaches IonQ', async () => {
  const response = await handleQuantum(request(submission), { env, fetcher: async () => new Response(env.IONQ_API_KEY, { status: 403 }) });
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes(env.IONQ_API_KEY));
  const invalid = await handleQuantum(request({ ...submission, shots: 4097 }), { env, fetcher: () => assert.fail('Invalid shot count') });
  assert.equal(invalid.status, 400);
});

test('public setup status never reveals provider keys and uses no-store', async () => {
  const response = await handleQuantum(new Request('https://almond.test/api/quantum'), { env });
  const text = await response.text();
  assert.ok(!text.includes(env.IONQ_API_KEY));
  assert.ok(!text.includes(env.ALMOND_EXECUTION_TOKEN));
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
