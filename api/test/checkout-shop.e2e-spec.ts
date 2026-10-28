import 'reflect-metadata';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import request from 'supertest';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error('TEST_DATABASE_URL is required for checkout/shop integration tests');
process.env.DATABASE_URL = testUrl;
const db = new pg.Pool({ connectionString: testUrl });
const keys = [0, 1].map(() => `paybd_test_${randomBytes(32).toString('base64url')}`);
const merchantIds: string[] = [];
let app: INestApplication;
let applicationPool: pg.Pool;
let products: Array<{ id: string; price_paisa: number }>;
const methods = ['card', 'bkash', 'nagad', 'rocket', 'bank'] as const;
const checkout = (id: string) => request(app.getHttpServer()).get(`/v1/checkout/${id}`);
const action = (id: string, name: string, body: object = {}) => request(app.getHttpServer()).post(`/v1/checkout/${id}/${name}`).send(body);
const order = (items: unknown, key: string = randomUUID(), merchant = 0) => request(app.getHttpServer()).post('/v1/shop/orders')
  .set('Authorization', `Bearer ${keys[merchant]}`).set('Idempotency-Key', key).send({ items });
const lookupOrder = (id: string, merchant = 0) => request(app.getHttpServer()).get(`/v1/shop/orders/${id}`)
  .set('Authorization', `Bearer ${keys[merchant]}`);
function success(response: { status: number }) { expect(response.status).toBe(200); }
async function createPayment() {
  const response = await request(app.getHttpServer()).post('/v1/payments')
    .set('Authorization', `Bearer ${keys[0]}`).set('Idempotency-Key', randomUUID()).send({
      amount_paisa: 10235, currency: 'BDT', merchant_order_id: `M23-${randomUUID()}`,
      success_url: 'http://localhost:3001/shop', cancel_url: 'http://localhost:3001/shop',
    }).expect(201);
  return response.body.id as string;
}
async function history(id: string) {
  return (await db.query('SELECT to_status FROM public.payment_status_history WHERE payment_id=$1 ORDER BY id', [id])).rows.map(row => row.to_status);
}
async function expiredPayment() {
  const id = randomUUID();
  await db.query(`INSERT INTO public.payments(id,merchant_id,merchant_order_id,amount_paisa,currency,success_url,cancel_url,
    idempotency_key,request_fingerprint,created_at,expires_at)
    VALUES ($1,$2,$3,10000,'BDT','http://localhost/success','http://localhost/cancel',$4,$5,
      now()-interval '1 hour',now()-interval '30 minutes')`,
  [id, merchantIds[0], `EXPIRED-FIXTURE-${id}`, randomUUID(), 'a'.repeat(64)]);
  return id;
}

beforeAll(async () => {
  const files = (await readdir(resolve('db/migrations'))).filter(f => /^\d{3}_.*\.sql$/.test(f)).sort();
  for (const file of files) await db.query(await readFile(resolve('db/migrations', file), 'utf8'));
  for (let i = 0; i < keys.length; i++) {
    const merchant = await db.query(`INSERT INTO public.merchants(business_name,email,status) VALUES($1,$2,'ACTIVE') RETURNING id`,
      [`M23 fictional integration merchant ${i}`, `${randomUUID()}@example.test`]);
    merchantIds.push(merchant.rows[0].id);
    await db.query(`INSERT INTO public.merchant_api_keys(merchant_id,name,key_prefix,key_hash) VALUES($1,'M23 integration fixture','paybd_test_',$2)`,
      [merchantIds[i], createHash('sha256').update(keys[i]).digest('hex')]);
  }
  const { AppModule } = await import(pathToFileURL(resolve('dist/app.module.js')).href);
  ({ pool: applicationPool } = await import(pathToFileURL(resolve('dist/db.js')).href));
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication({ logger: false });
  await app.init();
  await app.listen(0, '127.0.0.1');
  const catalog = await request(app.getHttpServer()).get('/v1/shop/catalog').expect(200);
  products = catalog.body.products;
}, 30000);

afterAll(async () => {
  if (app) await app.close();
  if (applicationPool && !applicationPool.ended) await applicationPool.end();
  await db.end();
});

describe('Hosted checkout: public capability, fake verification, and final outcomes', () => {
  it('shows a safe checkout summary without merchant secrets or redirect URLs', async () => {
    const id = await createPayment();
    const response = await checkout(id).expect(200);
    expect(response.body).toMatchObject({ id, status: 'PENDING', amount_paisa: 10235, test_mode: true, notice: 'DEMO MODE: no real money' });
    for (const field of ['email', 'key_hash', 'request_fingerprint', 'success_url', 'cancel_url']) expect(response.body).not.toHaveProperty(field);
  });
  it('gives new payment requests two minutes and new fake OTP challenges one minute', async () => {
    const id = await createPayment();
    const payment = (await checkout(id).expect(200)).body;
    const remaining = Date.parse(payment.expires_at) - Date.parse(payment.server_time);
    expect(remaining).toBeGreaterThan(100000);
    expect(remaining).toBeLessThanOrEqual(120000);
    const challenge = await action(id, 'challenge', { method: 'card' });
    success(challenge);
    const stored = await db.query(`SELECT extract(epoch FROM expires_at-created_at)::float8 AS seconds
      FROM public.checkout_challenges WHERE id=$1`, [challenge.body.challenge_id]);
    expect(stored.rows[0].seconds).toBeGreaterThan(59);
    expect(stored.rows[0].seconds).toBeLessThan(61);
    expect(Date.parse(challenge.body.expires_at)).toBeLessThanOrEqual(Date.parse(payment.expires_at));
  });
  it('also limits newly started payment-link checkout to two minutes', async () => {
    const link = await db.query(`INSERT INTO public.payment_links(merchant_id,title,amount_paisa,reusable,expires_at)
      VALUES($1,'Short classroom checkout',10000,true,clock_timestamp()+interval '1 hour') RETURNING id`, [merchantIds[0]]);
    const created = await request(app.getHttpServer()).post(`/v1/pay/${link.rows[0].id}/checkout`)
      .set('Idempotency-Key', randomUUID()).send({}).expect(201);
    const payment = (await checkout(created.body.id).expect(200)).body;
    const remaining = Date.parse(payment.expires_at) - Date.parse(payment.server_time);
    expect(remaining).toBeGreaterThan(100000);
    expect(remaining).toBeLessThanOrEqual(120000);
  });
  it('uses the server default outcome and safely replays concurrent confirmation without a customer outcome field', async () => {
    const id = await createPayment();
    const challenge = await action(id, 'challenge', { method: 'nagad' });
    const body = { challenge_id: challenge.body.challenge_id, code: '000000' };
    const confirmations = await Promise.all(Array.from({ length: 8 }, () => action(id, 'confirm', body)));
    for (const response of confirmations) {
      success(response);
      expect(response.body.status).toBe('PAID');
    }
    expect(await history(id)).toEqual(['PENDING', 'PAID']);
    success(await action(id, 'confirm', { ...body, outcome: 'success' }));
    await action(id, 'confirm', { ...body, outcome: 'failure' }).expect(409);
  });
  it.each([null, '', 'random', 1, false])('rejects an explicit invalid optional outcome %j', async outcome => {
    const id = await createPayment();
    const challenge = await action(id, 'challenge', { method: 'rocket' });
    await action(id, 'confirm', { challenge_id: challenge.body.challenge_id, code: '000000', outcome }).expect(400);
    expect((await checkout(id)).body.status).toBe('PENDING');
  });
  it('preserves existing payment deadlines when the additive window migration is reapplied', async () => {
    const id = await createPayment();
    const before = (await checkout(id).expect(200)).body.expires_at;
    await db.query(await readFile(resolve('db/migrations/011_checkout_session_windows.sql'), 'utf8'));
    expect((await checkout(id).expect(200)).body.expires_at).toBe(before);
    expect(await history(id)).toEqual(['PENDING']);
  });
  it('persists elapsed payment expiry when a default-outcome confirmation first discovers it', async () => {
    const id = await expiredPayment();
    const challenge = await db.query(`INSERT INTO public.checkout_challenges(payment_id,method,expires_at)
      VALUES($1,'card',clock_timestamp()+interval '60 seconds') RETURNING id`, [id]);
    await action(id, 'confirm', { challenge_id: challenge.rows[0].id, code: '000000' }).expect(409);
    expect((await checkout(id).expect(200)).body.status).toBe('EXPIRED');
    expect(await history(id)).toEqual(['PENDING', 'EXPIRED']);
    const row = await db.query('SELECT completed_at,completed_outcome FROM public.checkout_challenges WHERE id=$1', [challenge.rows[0].id]);
    expect(row.rows[0]).toEqual({ completed_at: null, completed_outcome: null });
  });
  it('rejects malformed and unknown checkout references', async () => {
    await checkout('bad-id').expect(400);
    await checkout(randomUUID()).expect(404);
  });
  it.each(methods)('completes simulated %s using the visible practice code', async method => {
    const id = await createPayment();
    const challenge = await action(id, 'challenge', { method });
    success(challenge);
    expect(challenge.body.fake_code).toBe('000000');
    expect(challenge.body.challenge_id).toMatch(/^[a-f0-9-]{36}$/);
    const response = await action(id, 'confirm', { challenge_id: challenge.body.challenge_id, code: '000000', outcome: 'success' });
    success(response);
    expect(response.body.status).toBe('PAID');
    expect(await history(id)).toEqual(['PENDING', 'PAID']);
    expect((await checkout(id)).body.status).toBe('PAID');
  });
  it('simulates failure and cannot pay the failed payment afterward', async () => {
    const id = await createPayment();
    const challenge = await action(id, 'challenge', { method: 'bkash' });
    const response = await action(id, 'confirm', { challenge_id: challenge.body.challenge_id, code: '000000', outcome: 'failure' });
    success(response);
    expect(response.body.status).toBe('FAILED');
    await action(id, 'confirm', { challenge_id: challenge.body.challenge_id, code: '000000', outcome: 'success' }).expect(409);
    expect(await history(id)).toEqual(['PENDING', 'FAILED']);
  });
  it.each(['cancel', 'expire'])('%s reaches its terminal result exactly once', async name => {
    const id = await createPayment();
    const first = await action(id, name);
    success(first);
    expect(first.body.status).toBe(name === 'cancel' ? 'CANCELLED' : 'EXPIRED');
    success(await action(id, name));
    expect(await history(id)).toEqual(['PENDING', first.body.status]);
    await action(id, 'challenge', { method: 'bank' }).expect(409);
  });
  it('rejects real-data-shaped fields at challenge and confirmation boundaries', async () => {
    const id = await createPayment();
    await action(id, 'challenge', { method: 'card', card_number: 'DO-NOT-ACCEPT' }).expect(400);
    await action(id, 'challenge', { method: 'bank', account_number: 'DO-NOT-ACCEPT' }).expect(400);
    await action(id, 'challenge', { method: 'unknown' }).expect(400);
    const challenge = await action(id, 'challenge', { method: 'card' });
    await action(id, 'confirm', { challenge_id: challenge.body.challenge_id, code: '000000', outcome: 'success', pin: 'DO-NOT-ACCEPT' }).expect(400);
    expect((await checkout(id)).body.status).toBe('PENDING');
  });
  it('rejects a wrong practice code while keeping the payment pending', async () => {
    const id = await createPayment();
    const challenge = await action(id, 'challenge', { method: 'nagad' });
    const rejected = await action(id, 'confirm', { challenge_id: challenge.body.challenge_id, code: '111111', outcome: 'success' });
    expect([400, 401]).toContain(rejected.status);
    expect((await checkout(id)).body.status).toBe('PENDING');
    expect(await history(id)).toEqual(['PENDING']);
  });
  it('persists bad-code attempts and locks a challenge after five failures', async () => {
    const id = await createPayment();
    const challenge = await action(id, 'challenge', { method: 'rocket' });
    const body = { challenge_id: challenge.body.challenge_id, code: '111111', outcome: 'success' };
    for (let i = 0; i < 5; i++) await action(id, 'confirm', body).expect(400);
    await action(id, 'confirm', { ...body, code: '000000' }).expect(429);
    const row = await db.query('SELECT attempts FROM public.checkout_challenges WHERE id=$1', [challenge.body.challenge_id]);
    expect(row.rows[0].attempts).toBe(5);
    expect((await checkout(id)).body.status).toBe('PENDING');
  });
  it('rejects an expired challenge without changing the payment state', async () => {
    const id = await createPayment();
    const challenge = await action(id, 'challenge', { method: 'card' });
    await db.query("UPDATE public.checkout_challenges SET expires_at=now()-interval '1 second' WHERE id=$1", [challenge.body.challenge_id]);
    await action(id, 'confirm', { challenge_id: challenge.body.challenge_id, code: '000000', outcome: 'success' }).expect(409);
    expect((await checkout(id)).body.status).toBe('PENDING');
    expect(await history(id)).toEqual(['PENDING']);
  });
  it('commits natural expiry even when the first attempted action is rejected', async () => {
    const id = await expiredPayment();
    await action(id, 'challenge', { method: 'card' }).expect(409);
    const row = await db.query('SELECT status FROM public.payments WHERE id=$1', [id]);
    expect(row.rows[0].status).toBe('EXPIRED');
    expect(await history(id)).toEqual(['PENDING', 'EXPIRED']);
  });
  it('supersedes an old challenge when a new method is selected', async () => {
    const id = await createPayment();
    const first = await action(id, 'challenge', { method: 'card' });
    const second = await action(id, 'challenge', { method: 'rocket' });
    expect(second.body.challenge_id).not.toBe(first.body.challenge_id);
    await action(id, 'confirm', { challenge_id: first.body.challenge_id, code: '000000', outcome: 'success' }).expect(409);
    const complete = await action(id, 'confirm', { challenge_id: second.body.challenge_id, code: '000000', outcome: 'success' });
    success(complete);
    expect(complete.body.status).toBe('PAID');
  });
  it('rejects a challenge from another payment', async () => {
    const firstId = await createPayment(), secondId = await createPayment();
    const challenge = await action(firstId, 'challenge', { method: 'bank' });
    const response = await action(secondId, 'confirm', { challenge_id: challenge.body.challenge_id, code: '000000', outcome: 'success' });
    expect([404, 409]).toContain(response.status);
    expect((await checkout(secondId)).body.status).toBe('PENDING');
  });
  it('serializes repeated successful confirmation without duplicate history', async () => {
    const id = await createPayment();
    const challenge = await action(id, 'challenge', { method: 'card' });
    const body = { challenge_id: challenge.body.challenge_id, code: '000000', outcome: 'success' };
    const responses = await Promise.all(Array.from({ length: 12 }, () => action(id, 'confirm', body)));
    for (const response of responses) { success(response); expect(response.body.status).toBe('PAID'); }
    expect(await history(id)).toEqual(['PENDING', 'PAID']);
  });
  it('allows only one terminal result under a confirmation/cancel/expire race', async () => {
    const id = await createPayment();
    const challenge = await action(id, 'challenge', { method: 'card' });
    const responses = await Promise.all([
      action(id, 'confirm', { challenge_id: challenge.body.challenge_id, code: '000000', outcome: 'success' }),
      action(id, 'cancel'), action(id, 'expire'),
    ]);
    expect(responses.filter(r => [200, 201].includes(r.status))).toHaveLength(1);
    expect(responses.filter(r => r.status === 409)).toHaveLength(2);
    const current = await checkout(id);
    expect(['PAID', 'CANCELLED', 'EXPIRED']).toContain(current.body.status);
    expect(await history(id)).toEqual(['PENDING', current.body.status]);
  });
  it('expires naturally elapsed payments on read and never pays them afterward', async () => {
    const id = await expiredPayment();
    expect((await checkout(id).expect(200)).body.status).toBe('EXPIRED');
    await action(id, 'challenge', { method: 'card' }).expect(409);
    expect(await history(id)).toEqual(['PENDING', 'EXPIRED']);
  });
});

describe('Demo shop: authoritative pricing, cart idempotency, and result lookup', () => {
  it('provides a fictional catalogue with integer paisa prices', async () => {
    expect(products.length).toBeGreaterThanOrEqual(3);
    for (const p of products) expect(Number.isSafeInteger(p.price_paisa) && p.price_paisa > 0).toBe(true);
  });
  it('requires merchant authentication and an idempotency header', async () => {
    await request(app.getHttpServer()).post('/v1/shop/orders').send({ items: [{ product_id: products[0].id, quantity: 1 }] }).expect(401);
    await request(app.getHttpServer()).post('/v1/shop/orders').set('Authorization', `Bearer ${keys[0]}`)
      .send({ items: [{ product_id: products[0].id, quantity: 1 }] }).expect(400);
  });
  it.each([[], null, {}, [{ product_id: 'missing-product', quantity: 1 }]])('rejects invalid cart %j', async items => {
    await order(items).expect(400);
  });
  it.each([0, -1, 1.5, 11, '1', null])('rejects invalid quantity %s', async quantity => {
    await order([{ product_id: products[0].id, quantity }]).expect(400);
  });
  it('rejects supplied prices and totals instead of trusting browser values', async () => {
    await order([{ product_id: products[0].id, quantity: 1, price_paisa: 1 }]).expect(400);
    await request(app.getHttpServer()).post('/v1/shop/orders').set('Authorization', `Bearer ${keys[0]}`)
      .set('Idempotency-Key', randomUUID()).send({ items: [{ product_id: products[0].id, quantity: 1 }], amount_paisa: 1 }).expect(400);
  });
  it('creates an order and payment priced from the server catalogue', async () => {
    const items = [{ product_id: products[0].id, quantity: 2 }, { product_id: products[1].id, quantity: 1 }];
    const response = await order(items).expect(201);
    expect(response.body.amount_paisa).toBe(products[0].price_paisa * 2 + products[1].price_paisa);
    expect(response.body.status).toBe('PENDING');
    expect(response.body.payment_id).toBe(response.body.id);
    expect(new URL(response.body.checkout_url).pathname).toBe(`/checkout/${response.body.payment_id}`);
    expect((await checkout(response.body.payment_id)).body.amount_paisa).toBe(response.body.amount_paisa);
  });
  it('normalizes duplicate/reordered lines for safe idempotent retries', async () => {
    const key = randomUUID();
    const first = await order([{ product_id: products[0].id, quantity: 1 }, { product_id: products[1].id, quantity: 1 }, { product_id: products[0].id, quantity: 1 }], key).expect(201);
    const second = await order([{ product_id: products[1].id, quantity: 1 }, { product_id: products[0].id, quantity: 2 }], key).expect(201);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.amount_paisa).toBe(first.body.amount_paisa);
    await order([{ product_id: products[0].id, quantity: 3 }], key).expect(409);
  });
  it('creates one order/payment for twelve simultaneous Pay requests', async () => {
    const key = randomUUID(), items = [{ product_id: products[0].id, quantity: 1 }];
    const responses = await Promise.all(Array.from({ length: 12 }, () => order(items, key)));
    expect(responses.map(r => r.status)).toEqual(Array(12).fill(201));
    expect(new Set(responses.map(r => r.body.id)).size).toBe(1);
    expect(await history(responses[0].body.payment_id)).toEqual(['PENDING']);
  });
  it('scopes orders and idempotency keys to the merchant', async () => {
    const key = randomUUID(), items = [{ product_id: products[0].id, quantity: 1 }];
    const first = await order(items, key, 0).expect(201);
    const second = await order(items, key, 1).expect(201);
    expect(first.body.id).not.toBe(second.body.id);
    await lookupOrder(first.body.id, 1).expect(404);
    await request(app.getHttpServer()).get(`/v1/shop/orders/${first.body.id}`).expect(401);
  });
  it('reads result status from the payment record, ignoring claimed URL success', async () => {
    const created = await order([{ product_id: products[0].id, quantity: 1 }]).expect(201);
    const id = created.body.id;
    const fakeResult = await request(app.getHttpServer()).get(`/v1/shop/orders/${id}?status=PAID`)
      .set('Authorization', `Bearer ${keys[0]}`).expect(200);
    expect(fakeResult.body.status).toBe('PENDING');
    const challenge = await action(id, 'challenge', { method: 'nagad' });
    success(await action(id, 'confirm', { challenge_id: challenge.body.challenge_id, code: '000000', outcome: 'success' }));
    expect((await lookupOrder(id).expect(200)).body.status).toBe('PAID');
  });
});
