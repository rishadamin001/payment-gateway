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
    'M8 tests require the separate payment_gateway_test database',
  );
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.PAYBD_WEBHOOK_WORKER = '0';
const db = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
let app: INestApplication, apiPool: pg.Pool;
let cookie = '',
  merchantId = '',
  other = '';
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
async function account() {
  const r = await post(
    'signup',
    {
      business_name: 'M8 fictional workshop',
      email: `showcase-${randomUUID()}@example.test`,
      password: randomBytes(24).toString('hex'),
    },
    '',
  ).expect(201);
  const session = r.headers['set-cookie'][0].split(';')[0];
  return { session, id: (await get('me', session)).body.id as string };
}
beforeAll(async () => {
  for (const file of (await readdir('db/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort())
    await db.query(await readFile(resolve('db/migrations', file), 'utf8'));
  const { AppModule } = await import(
    pathToFileURL(resolve('dist/app.module.js')).href
  );
  ({ pool: apiPool } = await import(pathToFileURL(resolve('dist/db.js')).href));
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = module.createNestApplication({ logger: false, rawBody: true });
  await app.listen(0, '127.0.0.1');
  const primary = await account();
  cookie = primary.session;
  merchantId = primary.id;
  other = (await account()).session;
}, 60000);
afterAll(async () => {
  await app?.close();
  await apiPool?.end();
  await db.end();
});

it('requires a merchant session, same-origin mutation and documented empty body', async () => {
  await post('demo-data', {}, '').expect(401);
  await request(app.getHttpServer())
    .post('/v1/merchant/demo-data')
    .set('Cookie', cookie)
    .set('Origin', 'https://outside.example.test')
    .send({})
    .expect(403);
  await post('demo-data', { reset: true }).expect(400);
  expect((await get('payments')).body.total).toBe(0);
});
it('creates one atomic sample batch for concurrent requests and never duplicates examples', async () => {
  const results = await Promise.all(
    Array.from({ length: 8 }, () => post('demo-data')),
  );
  expect(results.every((r) => r.status === 201)).toBe(true);
  expect(results.filter((r) => r.body.created).length).toBe(1);
  const counts = results[0].body.counts;
  expect(counts.payments).toBeGreaterThanOrEqual(20);
  expect(counts.refunds).toBeGreaterThanOrEqual(2);
  expect(counts.invoices).toBe(4);
  for (const r of results) expect(r.body.counts).toEqual(counts);
  const before = (await get('payments')).body.total;
  expect((await post('demo-data').expect(201)).body.created).toBe(false);
  expect((await get('payments')).body.total).toBe(before);
  expect(
    (
      await db.query(
        'SELECT count(*)::int n FROM demo_sample_batches WHERE merchant_id=$1',
        [merchantId],
      )
    ).rows[0].n,
  ).toBe(1);
});
it('populates all seven payment states, real refund histories and matched double-entry finance', async () => {
  const states = (
    await db.query(
      'SELECT DISTINCT status FROM payments WHERE merchant_id=$1',
      [merchantId],
    )
  ).rows
    .map((r) => r.status)
    .sort();
  expect(states).toEqual([
    'CANCELLED',
    'EXPIRED',
    'FAILED',
    'PAID',
    'PARTIALLY_REFUNDED',
    'PENDING',
    'REFUNDED',
  ]);
  const refunded = (
    await db.query(
      "SELECT id FROM payments WHERE merchant_id=$1 AND status='REFUNDED' LIMIT 1",
      [merchantId],
    )
  ).rows[0];
  const refunds = (await get(`payments/${refunded.id}/refunds`)).body;
  expect(refunds.refunds.length).toBeGreaterThan(0);
  expect(refunds.remaining_paisa).toBe(0);
  expect(
    refunds.refunds[0].history.map((h: { status: string }) => h.status),
  ).toEqual(['REQUESTED', 'SUCCEEDED']);
  const finance = (await get('finance')).body;
  expect(finance.settlements.length).toBeGreaterThan(0);
  expect(finance.payouts.length).toBeGreaterThan(0);
  for (const journal of finance.journals) {
    expect(journal.entries).toHaveLength(2);
    expect(journal.entries[0].amount_paisa).toBe(
      journal.entries[1].amount_paisa,
    );
  }
  expect((await get('finance/reconciliation')).body).toMatchObject({
    status: 'MATCHED',
    imbalance_paisa: 0,
    unknown_legacy_refunds: 0,
  });
});
it('fills links, four invoice states, reminders, webhook events and multi-day charts without exposing secrets', async () => {
  const links = (await get('links')).body.links;
  expect(links.some((l: { reusable: boolean }) => l.reusable)).toBe(true);
  expect(links.some((l: { status: string }) => l.status === 'EXPIRED')).toBe(
    true,
  );
  const invoices = (await get('invoices')).body.invoices;
  expect(invoices.map((i: { status: string }) => i.status).sort()).toEqual([
    'DRAFT',
    'OVERDUE',
    'PAID',
    'SENT',
  ]);
  const overdue = invoices.find(
    (i: { status: string }) => i.status === 'OVERDUE',
  );
  expect(
    (await get(`invoices/${overdue.id}`)).body.reminders.length,
  ).toBeGreaterThan(0);
  expect((await get('webhooks/events')).body.events.length).toBeGreaterThan(0);
  expect((await get('webhooks')).body.signing_secret).toBeUndefined();
  expect((await get('payments')).body.chart.length).toBeGreaterThanOrEqual(10);
});
it('preserves existing transactions and paused webhook settings while keeping merchants isolated', async () => {
  const before = await post(
    'demo-payment',
    {
      amount_paisa: 5000,
      currency: 'BDT',
      merchant_order_id: 'M8-KEEP-EXISTING',
      success_url: 'http://localhost:3001/merchant',
      cancel_url: 'http://localhost:3001/merchant',
    },
    other,
  )
    .set('Idempotency-Key', randomUUID())
    .expect(201);
  await post(
    'webhooks',
    { enabled: false, receiver_mode: 'always_fail' },
    other,
  ).expect(201);
  const sample = (await post('demo-data', {}, other).expect(201)).body;
  expect(sample.created).toBe(true);
  expect((await get('payments', other)).body.total).toBe(
    sample.counts.payments + 1,
  );
  expect((await get(`payments/${before.body.id}`, other)).body).toMatchObject({
    amount_paisa: 5000,
    status: 'PENDING',
  });
  expect((await get('webhooks', other)).body).toMatchObject({
    enabled: false,
    receiver_mode: 'always_fail',
  });
  expect((await get('webhooks/events', other)).body.events).toHaveLength(0);
  await get(`payments/${before.body.id}`).expect(404);
});
it('blocks suspended merchants without creating a batch or any sample transactions', async () => {
  const suspended = await account();
  await db.query("UPDATE merchants SET status='SUSPENDED' WHERE id=$1", [
    suspended.id,
  ]);
  await post('demo-data', {}, suspended.session).expect(403);
  expect(
    (
      await db.query(
        'SELECT count(*)::int n FROM demo_sample_batches WHERE merchant_id=$1',
        [suspended.id],
      )
    ).rows[0].n,
  ).toBe(0);
  expect((await get('payments', suspended.session)).body.total).toBe(0);
});
