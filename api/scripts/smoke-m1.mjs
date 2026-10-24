// Live local M1 smoke test. Keys are read only from process environment.
// Creates clearly labeled fictional payments; never deletes existing records.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const apiUrl = process.env.PAYBD_API_URL ?? 'http://127.0.0.1:3000';
const key = process.env.PAYBD_DEMO_API_KEY;
const databaseUrl = process.env.DATABASE_URL;
if (!key || !databaseUrl) {
  throw new Error('PAYBD_DEMO_API_KEY and DATABASE_URL must be set in the process environment');
}
const origin = new URL(apiUrl);
if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password ||
    !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) {
  throw new Error('The M1 smoke test must target a local HTTP(S) API');
}
const pool = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
async function call(method, path, { body, idempotencyKey, apiKey } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const response = await fetch(new URL(path, origin), {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  return { status: response.status, data: await response.json() };
}
function payment(order) {
  return {
    amount_paisa: 150000, currency: 'BDT', merchant_order_id: order,
    success_url: 'http://localhost:3001/demo/success',
    cancel_url: 'http://localhost:3001/demo/cancel',
  };
}
let phase = 'startup';
async function run() {
  console.log('DEMO MODE: no real money — M1 local smoke checks');
  phase = 'existing health and merchants endpoints';
  const health = await call('GET', '/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.status, 'ok');
  assert.equal(health.data.database, 'connected');
  assert.equal(health.data.notice, 'DEMO MODE: no real money');
  const merchants = await call('GET', '/merchants');
  assert.equal(merchants.status, 200);
  assert.ok(Array.isArray(merchants.data));
  assert.ok(merchants.data.length >= 4);
  console.log('PASS: existing health and merchant endpoints');

  phase = 'test-key authentication and validation';
  const idempotencyKey = `smoke-${randomUUID()}`;
  const requestBody = payment(`SMOKE-${randomUUID()}`);
  assert.equal((await call('POST', '/v1/payments', { body: requestBody, idempotencyKey })).status, 401);
  assert.equal((await call('POST', '/v1/payments', {
    body: { ...requestBody, amount_paisa: 1.5 }, idempotencyKey, apiKey: key,
  })).status, 400);
  console.log('PASS: authentication required and fractional paisa rejected');

  phase = 'payment creation';
  const first = await call('POST', '/v1/payments', { body: requestBody, idempotencyKey, apiKey: key });
  assert.equal(first.status, 201);
  assert.equal(first.data.status, 'PENDING');
  assert.equal(first.data.amount_paisa, 150000);
  assert.equal(first.data.amount_display, '৳1,500.00');
  assert.equal(first.data.test_mode, true);
  assert.equal(first.data.notice, 'DEMO MODE: no real money');
  assert.equal(new URL(first.data.checkout_url).pathname, `/checkout/${first.data.id}`);
  console.log('PASS: PENDING payment, integer paisa, taka display, checkout URL and demo notice');

  phase = 'idempotency and conflict';
  const same = await call('POST', '/v1/payments', { body: requestBody, idempotencyKey, apiKey: key });
  assert.equal(same.status, 201);
  assert.deepEqual(same.data, first.data);
  const changed = await call('POST', '/v1/payments', {
    body: { ...requestBody, amount_paisa: 250000 }, idempotencyKey, apiKey: key,
  });
  assert.equal(changed.status, 409);
  console.log('PASS: exact replay and changed-payload conflict');

  phase = 'lookup and merchant dashboard';
  const details = await call('GET', `/v1/payments/${first.data.id}`, { apiKey: key });
  assert.equal(details.status, 200);
  assert.equal(details.data.history.length, 1);
  assert.equal(details.data.history[0].from_status, null);
  assert.equal(details.data.history[0].to_status, 'PENDING');
  const list = await call('GET', '/v1/payments', { apiKey: key });
  assert.equal(list.status, 200);
  assert.equal(list.data.merchant.id, first.data.merchant_id);
  assert.ok(list.data.payments.every(p => p.merchant_id === first.data.merchant_id));
  assert.ok(list.data.payments.some(p => p.id === first.data.id));
  console.log('PASS: authenticated lookup, creation history and scoped merchant dashboard');

  phase = 'concurrent idempotency';
  const parallelKey = `parallel-${randomUUID()}`;
  const parallelBody = payment(`SMOKE-PARALLEL-${randomUUID()}`);
  const concurrent = await Promise.all(Array.from({ length: 10 }, () =>
    call('POST', '/v1/payments', { body: parallelBody, idempotencyKey: parallelKey, apiKey: key }),
  ));
  assert.ok(concurrent.every(result => result.status === 201));
  assert.equal(new Set(concurrent.map(result => result.data.id)).size, 1);
  const count = await pool.query(
    'SELECT count(*)::int AS n FROM public.payments WHERE merchant_id=$1 AND idempotency_key=$2',
    [first.data.merchant_id, parallelKey],
  );
  assert.equal(count.rows[0].n, 1);
  console.log('PASS: ten simultaneous requests created exactly one payment');

  phase = 'database transition guard';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("UPDATE public.payments SET status='PAID' WHERE id=$1", [first.data.id]);
    await assert.rejects(
      client.query("UPDATE public.payments SET status='PENDING' WHERE id=$1", [first.data.id]),
      { code: '23514' },
    );
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  const original = await call('GET', `/v1/payments/${first.data.id}`, { apiKey: key });
  assert.equal(original.data.status, 'PENDING');
  assert.equal(original.data.history.length, 1);
  console.log('PASS: invalid PAID → PENDING transition blocked; transaction fully rolled back');

  phase = 'seed coverage';
  const seeded = await pool.query(`SELECT DISTINCT status FROM public.payments
    WHERE idempotency_key LIKE 'seed-m1-%' ORDER BY status`);
  assert.deepEqual(seeded.rows.map(row => row.status),
    ['CANCELLED', 'EXPIRED', 'FAILED', 'PAID', 'PARTIALLY_REFUNDED', 'PENDING', 'REFUNDED']);
  console.log('PASS: fictional seed data covers all seven states');
  console.log('ALL M1 SMOKE CHECKS PASSED');
}
try {
  await run();
} catch {
  // Never dump request options, driver errors, environment values or key material.
  console.error(`M1 SMOKE CHECK FAILED during: ${phase}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
