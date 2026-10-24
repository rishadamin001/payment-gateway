import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
if (!process.env.TEST_DATABASE_URL)
  throw new Error('TEST_DATABASE_URL required');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.PAYBD_WEBHOOK_WORKER = '0';
const db = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
let app: INestApplication,
  apiPool: pg.Pool,
  service: { dispatch: () => Promise<void> };
let cookie = '',
  other = '',
  merchant = '',
  paid = '';
const previousPort = process.env.PORT;
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
async function payment() {
  const r = await post('demo-payment', {
    amount_paisa: 10000,
    currency: 'BDT',
    merchant_order_id: `M5-${randomUUID()}`,
    success_url: 'http://localhost:3001/merchant',
    cancel_url: 'http://localhost:3001/merchant',
  })
    .set('Idempotency-Key', randomUUID())
    .expect(201);
  await db.query("UPDATE payments SET status='PAID' WHERE id=$1", [r.body.id]);
  return r.body.id;
}
const refund = (
  id: string,
  amount?: number,
  key = randomUUID(),
  session = cookie,
) =>
  post(
    `payments/${id}/refunds`,
    {
      reason: 'Classroom simulated return',
      ...(amount === undefined ? {} : { amount_paisa: amount }),
    },
    session,
  ).set('Idempotency-Key', key);
beforeAll(async () => {
  for (const file of (await readdir('db/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort())
    await db.query(await readFile(resolve('db/migrations', file), 'utf8'));
  const { AppModule } = await import(
    pathToFileURL(resolve('dist/app.module.js')).href
  );
  const { OperationsService } = await import(
    pathToFileURL(resolve('dist/operations/operations.service.js')).href
  );
  ({ pool: apiPool } = await import(pathToFileURL(resolve('dist/db.js')).href));
  const mod = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  service = mod.get(OperationsService);
  app = mod.createNestApplication({ logger: false, rawBody: true });
  await app.listen(0, '127.0.0.1');
  process.env.PORT = String(app.getHttpServer().address().port);
  for (let i = 0; i < 2; i++) {
    const r = await post(
      'signup',
      {
        email: `operations-${randomUUID()}@example.test`,
        business_name: 'M5 fictional merchant',
        password: randomBytes(24).toString('hex'),
      },
      '',
    ).expect(201);
    const c = r.headers['set-cookie'][0].split(';')[0];
    if (i === 0) cookie = c;
    else other = c;
  }
  merchant = (await get('me')).body.id;
}, 30000);
afterAll(async () => {
  await app?.close();
  await apiPool?.end();
  await db.end();
  if (previousPort === undefined) delete process.env.PORT;
  else process.env.PORT = previousPort;
});
it('configures demo-only signed webhook settings without exposing a secret', async () => {
  const r = await post('webhooks', {
    enabled: true,
    receiver_mode: 'fail_twice',
  }).expect(201);
  expect(r.body.enabled).toBe(true);
  expect(r.body.signing_secret).toBeUndefined();
  await post('webhooks', {
    enabled: true,
    receiver_mode: 'success',
    url: 'https://example.com',
  }).expect(400);
  expect((await get('webhooks', other)).body.enabled).toBe(false);
});
it('queues payment events atomically and retries twice before verified delivery', async () => {
  paid = await payment();
  let events = (await get('webhooks/events')).body.events;
  expect(events.map((e: { event_type: string }) => e.event_type)).toContain(
    'payment.created',
  );
  for (let i = 0; i < 3; i++) {
    await db.query(
      "UPDATE webhook_events SET next_attempt_at=now() WHERE merchant_id=$1 AND status IN ('PENDING','RETRY')",
      [merchant],
    );
    await service.dispatch();
  }
  events = (await get('webhooks/events')).body.events;
  expect(
    events.every((e: { status: string }) => e.status === 'DELIVERED'),
  ).toBe(true);
  expect(
    events[0].deliveries.map((d: { http_status: number }) => d.http_status),
  ).toEqual([503, 503, 200]);
  expect(
    events[0].deliveries.every(
      (d: { signature_valid: boolean }) => d.signature_valid,
    ),
  ).toBe(true);
  expect(
    (
      await db.query(
        'SELECT count(*)::int n FROM webhook_receipts WHERE event_id=$1',
        [events[0].id],
      )
    ).rows[0].n,
  ).toBe(1);
  await request(app.getHttpServer())
    .post('/v1/demo/webhook-receiver')
    .set('X-PayBD-Event', events[0].id)
    .set('X-PayBD-Timestamp', String(Math.floor(Date.now() / 1000)))
    .set('X-PayBD-Signature', '0'.repeat(64))
    .send({ id: events[0].id })
    .expect(401);
});
it('records partial, further partial and full remaining refunds with history', async () => {
  await refund(paid, 2500).expect(201);
  expect((await get(`payments/${paid}`)).body.status).toBe(
    'PARTIALLY_REFUNDED',
  );
  await refund(paid, 1000).expect(201);
  await refund(paid).expect(201);
  const r = await get(`payments/${paid}/refunds`).expect(200);
  expect(r.body.refunded_paisa).toBe(10000);
  expect(r.body.remaining_paisa).toBe(0);
  expect(r.body.refunds).toHaveLength(3);
  expect(
    r.body.refunds[0].history.map((h: { status: string }) => h.status),
  ).toEqual(['REQUESTED', 'SUCCEEDED']);
  expect(
    (await get(`payments/${paid}`)).body.history.map(
      (h: { to_status: string }) => h.to_status,
    ),
  ).toEqual(['PENDING', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED']);
});
it('replays one refund for twelve concurrent duplicates and rejects changed details', async () => {
  const p = await payment(),
    key = randomUUID();
  const r = await Promise.all(
    Array.from({ length: 12 }, () => refund(p, 10000, key)),
  );
  expect(r.map((x) => x.status)).toEqual(Array(12).fill(201));
  expect(new Set(r.map((x) => x.body.id)).size).toBe(1);
  await refund(p, 999, key).expect(409);
  expect((await get(`payments/${p}/refunds`)).body.refunds).toHaveLength(1);
});
it('prevents concurrent over-refunds and foreign merchant access', async () => {
  const p = await payment();
  const r = await Promise.all([refund(p, 7000), refund(p, 7000)]);
  expect(r.map((x) => x.status).sort()).toEqual([201, 409]);
  await refund(p, 5000).expect(409);
  await refund(p, 1, randomUUID(), other).expect(404);
  await get(`payments/${p}/refunds`, other).expect(404);
  await refund(p, 0).expect(400);
  await refund(p, 1.5).expect(400);
});
it('database rejects bypassed over-refunds and immutable refund changes', async () => {
  const p = await payment();
  await refund(p, 8000);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await expect(
      client.query(
        `INSERT INTO payment_refunds(payment_id,merchant_id,amount_paisa,reason,idempotency_key,request_fingerprint) VALUES($1,$2,3000,'test',$3,$4)`,
        [p, merchant, randomUUID(), 'a'.repeat(64)],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  const r = (await get(`payments/${p}/refunds`)).body.refunds[0];
  await expect(
    db.query('UPDATE payment_refunds SET amount_paisa=1 WHERE id=$1', [r.id]),
  ).rejects.toMatchObject({ code: '23514' });
});
it('exhausts retries, scopes logs/retry, and recovers manually', async () => {
  await post('webhooks', { enabled: true, receiver_mode: 'always_fail' });
  const p = await payment();
  for (let i = 0; i < 5; i++) {
    await db.query(
      "UPDATE webhook_events SET next_attempt_at=now() WHERE merchant_id=$1 AND status IN ('PENDING','RETRY')",
      [merchant],
    );
    await service.dispatch();
  }
  const events = (await get('webhooks/events')).body.events;
  const event = events.find(
    (e: { payload: { payment_id: string } }) => e.payload.payment_id === p,
  );
  expect(event.status).toBe('FAILED');
  expect(event.attempts).toBe(5);
  expect((await get('webhooks/events', other)).body.events).toHaveLength(0);
  await post(`webhooks/events/${event.id}/retry`, {}, other).expect(409);
  await post('webhooks', { enabled: true, receiver_mode: 'success' });
  await post(`webhooks/events/${event.id}/retry`).expect(201);
  await service.dispatch();
  const updated = (await get('webhooks/events')).body.events.find(
    (e: { id: string }) => e.id === event.id,
  );
  expect(updated.status).toBe('DELIVERED');
  expect(updated.attempts).toBe(6);
});
it('pauses delivery and queues no new events when disabled', async () => {
  await post('webhooks', { enabled: false, receiver_mode: 'success' });
  const p = await payment();
  expect(
    (
      await db.query(
        "SELECT count(*)::int n FROM webhook_events WHERE payload->>'payment_id'=$1",
        [p],
      )
    ).rows[0].n,
  ).toBe(0);
});
it('preserves legacy partial refunds without guessing their amounts or refunding again', async () => {
  const p = await payment();
  await db.query(
    "UPDATE payments SET status='PARTIALLY_REFUNDED' WHERE id=$1",
    [p],
  );
  const result = await get(`payments/${p}/refunds`).expect(200);
  expect(result.body).toMatchObject({
    totals_known: false,
    refunded_paisa: null,
    remaining_paisa: null,
    payment_status: 'PARTIALLY_REFUNDED',
    refunds: [],
  });
  await refund(p).expect(409);
  await refund(p, 1).expect(409);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await expect(
      client.query(
        `INSERT INTO payment_refunds(payment_id,merchant_id,amount_paisa,reason,idempotency_key,request_fingerprint) VALUES($1,$2,1,'legacy safeguard',$3,$4)`,
        [p, merchant, randomUUID(), 'a'.repeat(64)],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  expect((await get(`payments/${p}/refunds`)).body.refunds).toHaveLength(0);
  expect((await get(`payments/${p}`)).body.status).toBe('PARTIALLY_REFUNDED');
});
it('reports no remaining refundable balance for legacy fully refunded payments', async () => {
  const p = await payment();
  await db.query("UPDATE payments SET status='REFUNDED' WHERE id=$1", [p]);
  const result = await get(`payments/${p}/refunds`).expect(200);
  expect(result.body).toMatchObject({
    totals_known: true,
    refunded_paisa: 10000,
    remaining_paisa: 0,
    payment_status: 'REFUNDED',
    refunds: [],
  });
  await refund(p).expect(409);
});
it('keeps refund history append-only and only creates it through a refund', async () => {
  const p = await payment();
  const created = await refund(p, 2500).expect(201);
  const id = created.body.id;
  const before = (await get(`payments/${p}/refunds`)).body.refunds[0].history;
  for (const sql of [
    "INSERT INTO refund_status_history(refund_id,status) VALUES($1,'REQUESTED')",
    "UPDATE refund_status_history SET status='REQUESTED' WHERE refund_id=$1",
    'DELETE FROM refund_status_history WHERE refund_id=$1',
  ]) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await expect(client.query(sql, [id])).rejects.toMatchObject({
        code: '23514',
      });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }
  expect((await get(`payments/${p}/refunds`)).body.refunds[0].history).toEqual(
    before,
  );
  await refund(p).expect(201);
  expect(
    (await get(`payments/${p}/refunds`)).body.refunds.every(
      (r: { history: { status: string }[] }) =>
        r.history.map((h) => h.status).join(',') === 'REQUESTED,SUCCEEDED',
    ),
  ).toBe(true);
});
