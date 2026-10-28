import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, it, expect } from 'vitest';
import request from 'supertest';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

if (
  !process.env.TEST_DATABASE_URL ||
  new URL(process.env.TEST_DATABASE_URL).pathname !== '/payment_gateway_test'
)
  throw new Error(
    'M7 tests require the separate payment_gateway_test database',
  );
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.PAYBD_WEBHOOK_WORKER = '0';
const db = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
let app: INestApplication, apiPool: pg.Pool;
let cookie = '',
  other = '',
  merchantId = '',
  adminCookie = '',
  paymentId = '',
  settlementId = '';
const adminEmail = `admin-m7-${randomUUID()}@example.test`;
const adminPassword = randomBytes(24).toString('hex');
it('disables first-administrator signup on hosted instances', async () => {
  const previous = process.env.PAYBD_HOSTED;
  process.env.PAYBD_HOSTED = '1';
  try {
    expect((await adminGet('setup-status', '').expect(200)).body.setup_required).toBe(false);
    await adminPost('setup', { email: `blocked-${randomUUID()}@example.test`, password: randomBytes(24).toString('hex') }, '').expect(403);
  } finally {
    if (previous === undefined) delete process.env.PAYBD_HOSTED;
    else process.env.PAYBD_HOSTED = previous;
  }
});
const post = (path: string, body: object = {}, session = cookie) =>
  request(app.getHttpServer())
    .post('/v1/merchant/' + path)
    .set('Cookie', session)
    .set('Origin', 'http://localhost:3001')
    .send(body);
const get = (path: string, session = cookie) =>
  request(app.getHttpServer())
    .get('/v1/merchant/' + path)
    .set('Cookie', session);
const adminPost = (path: string, body: object = {}, session = adminCookie) =>
  request(app.getHttpServer())
    .post('/v1/admin/' + path)
    .set('Cookie', session)
    .set('Origin', 'http://localhost:3001')
    .send(body);
const adminGet = (path: string, session = adminCookie) =>
  request(app.getHttpServer())
    .get('/v1/admin/' + path)
    .set('Cookie', session);
async function account(name = 'M7 fictional merchant') {
  const r = await post(
    'signup',
    {
      business_name: name,
      email: `m7-${randomUUID()}@example.test`,
      password: randomBytes(24).toString('hex'),
    },
    '',
  ).expect(201);
  const session = r.headers['set-cookie'][0].split(';')[0];
  return { session, id: (await get('me', session)).body.id };
}
async function payment(
  amount = 10000,
  session = cookie,
  outcome: 'success' | 'failure' | 'pending' = 'success',
) {
  const r = await post(
    'demo-payment',
    {
      amount_paisa: amount,
      currency: 'BDT',
      merchant_order_id: `M7-${randomUUID()}`,
      success_url: 'http://localhost:3001/merchant',
      cancel_url: 'http://localhost:3001/merchant',
    },
    session,
  )
    .set('Idempotency-Key', randomUUID())
    .expect(201);
  if (outcome !== 'pending') {
    const c = await request(app.getHttpServer())
      .post(`/v1/checkout/${r.body.id}/challenge`)
      .send({ method: 'bank' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/checkout/${r.body.id}/confirm`)
      .send({ challenge_id: c.body.challenge_id, code: '000000', outcome })
      .expect(200);
  }
  return r.body.id as string;
}
const settle = (amount?: number, key = randomUUID(), session = cookie) =>
  post(
    'finance/settlements',
    amount === undefined ? {} : { amount_paisa: amount },
    session,
  ).set('Idempotency-Key', key);
const payout = (id: string, key = randomUUID(), session = cookie) =>
  post(`finance/settlements/${id}/payout`, {}, session).set(
    'Idempotency-Key',
    key,
  );
const refund = (id: string, amount?: number, session = cookie) =>
  post(
    `payments/${id}/refunds`,
    {
      reason: 'M7 fictional return',
      ...(amount === undefined ? {} : { amount_paisa: amount }),
    },
    session,
  ).set('Idempotency-Key', randomUUID());

beforeAll(async () => {
  for (const file of (await readdir('db/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort())
    await db.query(await readFile(resolve('db/migrations', file), 'utf8'));
  const { AppModule } = await import(
    pathToFileURL(resolve('dist/app.module.js')).href
  );
  const { hashPassword } = await import(
    pathToFileURL(resolve('dist/merchant/merchant-utils.js')).href
  );
  ({ pool: apiPool } = await import(pathToFileURL(resolve('dist/db.js')).href));
  await db.query(
    'INSERT INTO admin_accounts(email,password_hash) VALUES($1,$2)',
    [adminEmail, await hashPassword(adminPassword)],
  );
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = module.createNestApplication({ logger: false, rawBody: true });
  await app.listen(0, '127.0.0.1');
  const primary = await account();
  cookie = primary.session;
  merchantId = primary.id;
  other = (await account('Other M7 merchant')).session;
  const r = await adminPost(
    'login',
    { email: adminEmail, password: adminPassword },
    '',
  ).expect(201);
  adminCookie = r.headers['set-cookie'][0].split(';')[0];
}, 60000);
afterAll(async () => {
  await app?.close();
  await apiPool?.end();
  await db.end();
});

it('requires separate merchant/admin sessions and protects mutations from cross-site requests', async () => {
  await get('finance', '').expect(401);
  await get('finance', adminCookie).expect(401);
  await adminGet('me', cookie).expect(401);
  await adminGet('merchants', '').expect(401);
  await request(app.getHttpServer())
    .post('/v1/merchant/finance/settlements')
    .set('Cookie', cookie)
    .set('Origin', 'https://foreign.example')
    .set('Idempotency-Key', randomUUID())
    .send({})
    .expect(403);
  await request(app.getHttpServer())
    .post('/v1/admin/logout')
    .set('Cookie', adminCookie)
    .set('Origin', 'https://foreign.example')
    .send({})
    .expect(403);
});

it('posts balanced capture and refund entries while pending requests have no monetary posting', async () => {
  paymentId = await payment(10000, cookie, 'pending');
  expect((await get('finance')).body.journals).toHaveLength(0);
  const c = await request(app.getHttpServer())
    .post(`/v1/checkout/${paymentId}/challenge`)
    .send({ method: 'card' })
    .expect(200);
  await request(app.getHttpServer())
    .post(`/v1/checkout/${paymentId}/confirm`)
    .send({
      challenge_id: c.body.challenge_id,
      code: '000000',
      outcome: 'success',
    })
    .expect(200);
  await refund(paymentId, 2500).expect(201);
  const finance = (await get('finance').expect(200)).body;
  expect(finance.balances).toMatchObject({
    available_paisa: 7500,
    reserved_paisa: 0,
    clearing_paisa: 7500,
  });
  expect(
    finance.journals.map((j: { source_type: string }) => j.source_type).sort(),
  ).toEqual(['PAYMENT', 'REFUND']);
  for (const journal of finance.journals) {
    expect(journal.entries).toHaveLength(2);
    const sum = (side: string) =>
      journal.entries
        .filter((e: { side: string }) => e.side === side)
        .reduce(
          (n: number, e: { amount_paisa: number }) => n + e.amount_paisa,
          0,
        );
    expect(sum('DEBIT')).toBe(journal.amount_paisa);
    expect(sum('CREDIT')).toBe(journal.amount_paisa);
  }
  expect((await get('finance/reconciliation')).body).toMatchObject({
    status: 'MATCHED',
    payment_total_paisa: 10000,
    refund_total_paisa: 2500,
    ledger_payment_paisa: 10000,
    ledger_refund_paisa: 2500,
    imbalance_paisa: 0,
  });
});

it('reserves a settlement once for concurrent duplicate requests and rejects changed details', async () => {
  const key = randomUUID();
  const responses = await Promise.all(
    Array.from({ length: 8 }, () => settle(5000, key)),
  );
  expect(responses.map((r) => r.status)).toEqual(Array(8).fill(201));
  expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
  settlementId = responses[0].body.id;
  await settle(4999, key).expect(409);
  expect((await get('finance')).body.balances).toMatchObject({
    available_paisa: 2500,
    reserved_paisa: 5000,
    clearing_paisa: 7500,
  });
});

it('records exactly one payout and reconciles clearing after concurrent retries', async () => {
  const key = randomUUID();
  const responses = await Promise.all(
    Array.from({ length: 8 }, () => payout(settlementId, key)),
  );
  expect(responses.map((r) => r.status)).toEqual(Array(8).fill(201));
  expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
  const finance = (await get('finance')).body;
  expect(finance.payouts).toHaveLength(1);
  expect(finance.settlements[0].status).toBe('PAID_OUT');
  expect(finance.balances).toMatchObject({
    available_paisa: 2500,
    reserved_paisa: 0,
    clearing_paisa: 2500,
  });
  expect((await get('finance/reconciliation')).body).toMatchObject({
    status: 'MATCHED',
    payout_total_paisa: 5000,
    expected_clearing_paisa: 2500,
    clearing_paisa: 2500,
    imbalance_paisa: 0,
  });
});

it('keeps later refunds in the ledger and prevents settlements of negative available balances', async () => {
  await refund(paymentId).expect(201);
  expect((await get('finance')).body.balances).toMatchObject({
    available_paisa: -5000,
    reserved_paisa: 0,
    clearing_paisa: -5000,
  });
  expect((await get('finance/reconciliation')).body).toMatchObject({
    status: 'MATCHED',
    refund_total_paisa: 10000,
    ledger_refund_paisa: 10000,
    expected_clearing_paisa: -5000,
    imbalance_paisa: 0,
  });
  await settle().expect(409);
});

it('prevents concurrent over-settlement, fractional values and foreign merchant payout access', async () => {
  const m = await account('Concurrent M7 merchant');
  await payment(10000, m.session);
  const responses = await Promise.all([
    settle(7000, randomUUID(), m.session),
    settle(7000, randomUUID(), m.session),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
  const id = responses.find((r) => r.status === 201)!.body.id;
  await payout(id, randomUUID(), other).expect(404);
  expect((await get('finance', other)).body.settlements).toHaveLength(0);
  await settle(0, randomUUID(), m.session).expect(400);
  await settle(1.5, randomUUID(), m.session).expect(400);
  await settle(4000, randomUUID(), m.session).expect(409);
});

it('enforces ledger immutability and the deferred journal balance constraint at the database', async () => {
  const journal = (await get('finance')).body.journals[0];
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await expect(
      client.query(
        'UPDATE ledger_entries SET amount_paisa=1 WHERE journal_id=$1',
        [journal.id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  const m = await account('Journal constraint merchant');
  const p = await payment(100, m.session, 'pending');
  const transaction = await db.connect();
  try {
    await transaction.query('BEGIN');
    await transaction.query('SET CONSTRAINTS paybd_journal_balanced IMMEDIATE');
    await expect(
      transaction.query("UPDATE payments SET status='PAID' WHERE id=$1", [p]),
    ).rejects.toMatchObject({ code: '23514' });
  } finally {
    await transaction.query('ROLLBACK');
    transaction.release();
  }
  expect((await get(`payments/${p}`, m.session)).body.status).toBe('PENDING');
  expect((await get('finance', m.session)).body.journals).toHaveLength(0);
});

it('flags unknown legacy partial refunds without inventing balances or allowing settlement', async () => {
  const m = await account('Legacy M7 merchant');
  const p = await payment(10000, m.session);
  await db.query(
    "UPDATE payments SET status='PARTIALLY_REFUNDED' WHERE id=$1",
    [p],
  );
  const report = (await get('finance/reconciliation', m.session)).body;
  expect(report.status).toBe('REVIEW_REQUIRED');
  expect(report.unknown_legacy_refunds).toBe(1);
  expect(report.discrepancies.length).toBeGreaterThan(0);
  await settle(undefined, randomUUID(), m.session).expect(409);
});

it('rejects wrong admin credentials and closes first-admin setup once an account exists', async () => {
  await adminPost(
    'login',
    { email: adminEmail, password: randomBytes(24).toString('hex') },
    '',
  ).expect(401);
  expect((await adminGet('setup-status', '')).body.setup_required).toBe(false);
  await adminPost(
    'setup',
    {
      email: `blocked-${randomUUID()}@example.test`,
      password: randomBytes(24).toString('hex'),
    },
    '',
  ).expect(409);
  const me = (await adminGet('me').expect(200)).body;
  expect(me.email).toBe(adminEmail);
  expect(Object.keys(me)).not.toContain('password_hash');
  expect(adminCookie.startsWith('paybd_admin_session=')).toBe(true);
});

it('approves and suspends merchants, blocks new payment channels and preserves existing records', async () => {
  const m = await account('Suspension M7 merchant');
  const pending = await payment(1000, m.session, 'pending');
  const paid = await payment(1000, m.session);
  const key = (await post('keys', {}, m.session).expect(201)).body.api_key;
  const approved = await adminPost(`merchants/${m.id}/status`, {
    status: 'ACTIVE',
    reason: 'Classroom approval',
  }).expect(201);
  expect(approved.body.status).toBe('ACTIVE');
  expect(approved.body.approved_at).toBeTruthy();
  const challenge = await request(app.getHttpServer())
    .post(`/v1/checkout/${pending}/challenge`)
    .send({ method: 'card' })
    .expect(200);
  await adminPost(`merchants/${m.id}/status`, {
    status: 'SUSPENDED',
    reason: 'Classroom suspension test',
  }).expect(201);
  const input = {
    amount_paisa: 100,
    currency: 'BDT',
    merchant_order_id: randomUUID(),
    success_url: 'http://localhost:3001/merchant',
    cancel_url: 'http://localhost:3001/merchant',
  };
  await post('demo-payment', input, m.session)
    .set('Idempotency-Key', randomUUID())
    .expect(403);
  await request(app.getHttpServer())
    .post('/v1/payments')
    .set('Authorization', `Bearer ${key}`)
    .set('Idempotency-Key', randomUUID())
    .send(input)
    .expect(403);
  await request(app.getHttpServer())
    .post(`/v1/checkout/${pending}/confirm`)
    .send({
      challenge_id: challenge.body.challenge_id,
      code: '000000',
      outcome: 'success',
    })
    .expect(403);
  await settle(undefined, randomUUID(), m.session).expect(403);
  expect((await get(`payments/${pending}`, m.session)).body.status).toBe(
    'PENDING',
  );
  await refund(paid, 100, m.session).expect(201);
  const matches = (await adminGet(`merchants?search=${m.id}`)).body.merchants;
  expect(
    matches.some(
      (row: { id: string; status: string }) =>
        row.id === m.id && row.status === 'SUSPENDED',
    ),
  ).toBe(true);
  await adminPost(`merchants/${m.id}/status`, {
    status: 'ACTIVE',
    reason: 'Resume classroom demonstration',
  }).expect(201);
});

it('lists all transactions with filters and explains high-amount and repeated-failure risk flags', async () => {
  const m = await account('Risk M7 merchant');
  const high = await payment(100000000000, m.session);
  for (let i = 0; i < 3; i++) await payment(100, m.session, 'failure');
  const filtered = (
    await adminGet(`transactions?merchant_id=${m.id}&status=FAILED`).expect(200)
  ).body;
  expect(filtered.total).toBe(3);
  expect(
    filtered.payments.every(
      (p: { merchant_id: string; status: string }) =>
        p.merchant_id === m.id && p.status === 'FAILED',
    ),
  ).toBe(true);
  const exact = (await adminGet(`transactions?search=${high}`)).body;
  expect(exact.total).toBe(1);
  expect(exact.payments[0].risk_flags.length).toBeGreaterThan(0);
  const flags = (await adminGet('risk').expect(200)).body.flags.filter(
    (f: { merchant_id: string }) => f.merchant_id === m.id,
  );
  expect(
    flags.some((f: { payment_id?: string }) => f.payment_id === high),
  ).toBe(true);
  expect(
    flags.some((f: { failure_count?: number }) => f.failure_count === 3),
  ).toBe(true);
});

it('audits finance and administrator actions without exposing credentials and prevents audit edits', async () => {
  const report = (await adminGet(`audit?merchant_id=${merchantId}`).expect(200))
    .body;
  const actions = report.events.map((e: { action: string }) => e.action);
  expect(actions).toContain('settlement.created');
  expect(actions).toContain('payout.succeeded');
  expect(actions).toContain('refund.succeeded');
  const serialized = JSON.stringify(report);
  expect(serialized.includes(adminPassword)).toBe(false);
  expect(
    /"(?:password_hash|signing_secret|token_hash|api_key)"\s*:/.test(
      serialized,
    ),
  ).toBe(false);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await expect(
      client.query("UPDATE audit_log SET action='tampered' WHERE id=$1", [
        report.events[0].id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});

it('revokes the server-side admin session on logout', async () => {
  const r = await adminPost('logout').expect(201);
  expect(r.headers['set-cookie'][0]).toContain('Max-Age=0');
  await adminGet('me').expect(401);
  await adminGet('audit').expect(401);
});
