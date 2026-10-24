import 'reflect-metadata';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Require an explicit test DB. No DELETE, TRUNCATE or DROP is used: HTTP
// fixtures have unique names; direct SQL mutation tests always roll back.
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error('TEST_DATABASE_URL is required for M1 integration tests');
process.env.DATABASE_URL = testUrl;
const db = new pg.Pool({ connectionString: testUrl, max: 10 });
const runId = randomUUID();
const makeKey = () => `paybd_test_${randomBytes(32).toString('base64url')}`;
const keys = { active: makeKey(), other: makeKey(), revoked: makeKey(), pending: makeKey() };
const merchants: Record<string, string> = {};
let app: INestApplication;
let applicationPool: pg.Pool;
const notice = 'DEMO MODE: no real money';
const states = ['PENDING', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED', 'PARTIALLY_REFUNDED'] as const;
type State = typeof states[number];
const paths: Record<State, State[]> = {
  PENDING: [], PAID: ['PAID'], FAILED: ['FAILED'], CANCELLED: ['CANCELLED'],
  EXPIRED: ['EXPIRED'], REFUNDED: ['PAID', 'REFUNDED'],
  PARTIALLY_REFUNDED: ['PAID', 'PARTIALLY_REFUNDED'],
};
const allowed: Record<State, State[]> = {
  PENDING: ['PAID', 'FAILED', 'CANCELLED', 'EXPIRED'],
  PAID: ['REFUNDED', 'PARTIALLY_REFUNDED'], PARTIALLY_REFUNDED: ['REFUNDED'],
  FAILED: [], CANCELLED: [], EXPIRED: [], REFUNDED: [],
};
function payload(overrides: Record<string, unknown> = {}) {
  return {
    amount_paisa: 150000, currency: 'BDT', merchant_order_id: `TEST-${randomUUID()}`,
    success_url: 'http://localhost:3001/demo/success',
    cancel_url: 'http://localhost:3001/demo/cancel', ...overrides,
  };
}
function post(body = payload(), idempotencyKey: string = randomUUID(), key = keys.active) {
  return request(app.getHttpServer()).post('/v1/payments')
    .set('Authorization', `Bearer ${key}`).set('Idempotency-Key', idempotencyKey).send(body);
}
async function insertPending(client: pg.PoolClient, status: State = 'PENDING') {
  const id = randomUUID();
  await client.query(`INSERT INTO public.payments
    (id, merchant_id, merchant_order_id, amount_paisa, currency, status,
     success_url, cancel_url, idempotency_key, request_fingerprint)
    VALUES ($1,$2,$3,150000,'BDT',$4,'http://localhost/success','http://localhost/cancel',$5,$6)`,
  [id, merchants.active, `SQL-${id}`, status, randomUUID(), 'a'.repeat(64)]);
  return id;
}
async function rollback<T>(work: (client: pg.PoolClient) => Promise<T>) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    return await work(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

beforeAll(async () => {
  for (const file of ['001_merchants_baseline.sql', '002_payments_core.sql']) {
    await db.query(await readFile(resolve('db/migrations', file), 'utf8'));
  }
  for (const kind of ['active', 'other', 'revoked', 'pending'] as const) {
    const result = await db.query(`INSERT INTO public.merchants (business_name,email,status)
      VALUES ($1,$2,$3) RETURNING id`,
    [`M1 integration fictional ${kind}`, `${kind}-${runId}@example.test`, kind === 'pending' ? 'PENDING' : 'ACTIVE']);
    merchants[kind] = result.rows[0].id;
    await db.query(`INSERT INTO public.merchant_api_keys (merchant_id,name,key_prefix,key_hash,revoked_at)
      VALUES ($1,'M1 integration fixture','paybd_test_',$2,$3)`,
    [merchants[kind], createHash('sha256').update(keys[kind]).digest('hex'), kind === 'revoked' ? new Date() : null]);
  }
  // Production build preserves exactly the same decorator metadata as startup.
  const { AppModule } = await import(pathToFileURL(resolve('dist/app.module.js')).href);
  ({ pool: applicationPool } = await import(pathToFileURL(resolve('dist/db.js')).href));
  const fixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = fixture.createNestApplication({ logger: false });
  await app.init();
  // Keep one real loopback listener for concurrent requests. Letting Supertest
  // auto-start the same server per request races listener lifecycle events.
  await app.listen(0, '127.0.0.1');
}, 30000);

afterAll(async () => {
  if (app) await app.close();
  if (applicationPool && !applicationPool.ended) await applicationPool.end();
  await db.end();
});

describe('Existing endpoints and non-destructive migrations', () => {
  it('keeps the root endpoint', async () => {
    await request(app.getHttpServer()).get('/').expect(200).expect('Hello World!');
  });
  it('reports an actual connected database and demo mode', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);
    expect(response.body).toMatchObject({ status: 'ok', database: 'connected', notice });
  });
  it('preserves merchant records and returns their existing fields', async () => {
    const response = await request(app.getHttpServer()).get('/merchants').expect(200);
    expect(response.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: merchants.active, status: 'ACTIVE', email: `active-${runId}@example.test` }),
    ]));
  });
  it('reruns both migrations without changing a pre-existing merchant or payment', async () => {
    const created = await post().expect(201);
    const before = await db.query('SELECT * FROM public.merchants WHERE id = $1', [merchants.pending]);
    for (const file of ['001_merchants_baseline.sql', '002_payments_core.sql']) {
      await db.query(await readFile(resolve('db/migrations', file), 'utf8'));
    }
    const after = await db.query('SELECT * FROM public.merchants WHERE id = $1', [merchants.pending]);
    expect(after.rows).toEqual(before.rows);
    const found = await request(app.getHttpServer()).get(`/v1/payments/${created.body.id}`)
      .set('Authorization', `Bearer ${keys.active}`).expect(200);
    expect(found.body.history).toHaveLength(1);
  });
});

describe('Test API-key authentication', () => {
  it('rejects missing authorization for create and lookup', async () => {
    await request(app.getHttpServer()).post('/v1/payments').send(payload()).expect(401);
    await request(app.getHttpServer()).get(`/v1/payments/${randomUUID()}`).expect(401);
  });
  it.each(['Basic invalid', 'Bearer wrong', 'Bearer paybd_live_not_supported'])('rejects malformed authorization: %s', async header => {
    await request(app.getHttpServer()).post('/v1/payments').set('Authorization', header).send(payload()).expect(401);
  });
  it('rejects a well-formed unregistered key', async () => {
    await post(payload(), randomUUID(), makeKey()).expect(401);
  });
  it('rejects a revoked key', async () => { await post(payload(), randomUUID(), keys.revoked).expect(401); });
  it('rejects an inactive merchant', async () => { await post(payload(), randomUUID(), keys.pending).expect(403); });
  it('rejects revoked-key and inactive-merchant lookups', async () => {
    for (const [key, status] of [[keys.revoked, 401], [keys.pending, 403]] as const) {
      await request(app.getHttpServer()).get(`/v1/payments/${randomUUID()}`)
        .set('Authorization', `Bearer ${key}`).expect(status);
    }
  });
});

describe('Payment input validation', () => {
  it.each([0, -1, 1.5, 100000000001, Number.MAX_SAFE_INTEGER, '150000', null])('rejects invalid paisa: %s', async amount => {
    await post(payload({ amount_paisa: amount })).expect(400);
  });
  it.each(['USD', 'bdt', '', null])('rejects unsupported currency: %s', async currency => {
    await post(payload({ currency })).expect(400);
  });
  it.each(['', '   ', 'a'.repeat(101), null, 123])('rejects invalid order reference: %s', async merchant_order_id => {
    await post(payload({ merchant_order_id })).expect(400);
  });
  it.each(['javascript:alert(1)', 'file:///tmp/x', 'https://name:password@example.test', 'not a url', ''])('rejects unsafe redirect: %s', async url => {
    await post(payload({ success_url: url })).expect(400);
    await post(payload({ cancel_url: url })).expect(400);
  });
  it('rejects unknown fields so sensitive payment data cannot be accepted', async () => {
    await post(payload({ unexpected_field: 'not supported' })).expect(400);
  });
  it('rejects a missing Idempotency-Key', async () => {
    await request(app.getHttpServer()).post('/v1/payments')
      .set('Authorization', `Bearer ${keys.active}`).send(payload()).expect(400);
  });
  it.each(['short', 'has spaces', 'a'.repeat(129)])('rejects invalid idempotency header: %s', async key => {
    await post(payload(), key).expect(400);
  });
  it('rejects an array body', async () => {
    await request(app.getHttpServer()).post('/v1/payments').set('Authorization', `Bearer ${keys.active}`)
      .set('Idempotency-Key', randomUUID()).send([]).expect(400);
  });
});

describe('Creation, idempotency, concurrency and merchant isolation', () => {
  it('returns PENDING, integer paisa, formatted taka, checkout URL and demo notice', async () => {
    const response = await post().expect(201);
    expect(response.body).toMatchObject({ status: 'PENDING', amount_paisa: 150000, amount_display: '৳1,500.00',
      currency: 'BDT', test_mode: true, notice, merchant_id: merchants.active });
    expect(response.body.checkout_url).toBe(`${process.env.PAYBD_CHECKOUT_BASE_URL ?? 'http://localhost:3001'}/checkout/${response.body.id}`);
    expect(Number.isSafeInteger(response.body.amount_paisa)).toBe(true);
    expect(response.body).not.toHaveProperty('request_fingerprint');
    expect(response.body).not.toHaveProperty('key_hash');
  });
  it('accepts exact smallest and largest supported amounts', async () => {
    for (const amount_paisa of [1, 100000000000]) {
      const result = await post(payload({ amount_paisa })).expect(201);
      expect(result.body.amount_paisa).toBe(amount_paisa);
    }
  });
  it('replays an identical request without duplicating payment or history', async () => {
    const body = payload(), idempotency = randomUUID();
    const first = await post(body, idempotency).expect(201);
    const repeated = await post(body, idempotency).expect(201);
    expect(repeated.body).toEqual(first.body);
    const count = await db.query('SELECT count(*)::int AS n FROM public.payment_status_history WHERE payment_id=$1', [first.body.id]);
    expect(count.rows[0].n).toBe(1);
  });
  it('normalizes property order, trimmed order IDs and equivalent URLs before replay', async () => {
    const idempotency = randomUUID();
    const first = await post(payload({ merchant_order_id: `  ${runId}  `, success_url: 'https://example.test' }), idempotency).expect(201);
    const second = await post({ cancel_url: 'http://localhost:3001/demo/cancel', success_url: 'https://example.test/',
      merchant_order_id: runId, currency: 'BDT', amount_paisa: 150000 }, idempotency).expect(201);
    expect(second.body.id).toBe(first.body.id);
  });
  it.each([
    { amount_paisa: 150001 }, { merchant_order_id: 'CHANGED-ORDER' },
    { success_url: 'https://other.example.test/success' }, { cancel_url: 'https://other.example.test/cancel' },
  ])('rejects changed payment details on a reused key: %j', async change => {
    const body = payload(), idempotency = randomUUID();
    await post(body, idempotency).expect(201);
    await post({ ...body, ...change }, idempotency).expect(409);
  });
  it('serializes 20 simultaneous identical requests to exactly one payment and history event', async () => {
    const body = payload(), idempotency = randomUUID();
    const responses = await Promise.all(Array.from({ length: 20 }, () => post(body, idempotency)));
    expect(responses.map(r => r.status)).toEqual(Array(20).fill(201));
    expect(new Set(responses.map(r => r.body.id)).size).toBe(1);
    const counts = await db.query(`SELECT count(DISTINCT p.id)::int AS payments, count(h.id)::int AS events
      FROM public.payments p JOIN public.payment_status_history h ON h.payment_id = p.id
      WHERE p.merchant_id = $1 AND p.idempotency_key = $2`, [merchants.active, idempotency]);
    expect(counts.rows[0]).toEqual({ payments: 1, events: 1 });
  });
  it('allows only one winner when simultaneous requests reuse a key with different details', async () => {
    const body = payload(), idempotency = randomUUID();
    const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => post({ ...body, amount_paisa: 1000 + i }, idempotency)));
    expect(responses.filter(r => r.status === 201)).toHaveLength(1);
    expect(responses.filter(r => r.status === 409)).toHaveLength(11);
    const count = await db.query('SELECT count(*)::int AS n FROM public.payments WHERE merchant_id=$1 AND idempotency_key=$2', [merchants.active, idempotency]);
    expect(count.rows[0].n).toBe(1);
  });
  it('scopes idempotency keys and lookup to the authenticated merchant', async () => {
    const body = payload(), idempotency = randomUUID();
    const first = await post(body, idempotency, keys.active).expect(201);
    const second = await post(body, idempotency, keys.other).expect(201);
    expect(second.body.id).not.toBe(first.body.id);
    await request(app.getHttpServer()).get(`/v1/payments/${first.body.id}`)
      .set('Authorization', `Bearer ${keys.other}`).expect(404);
  });
  it('scopes the dashboard list to its merchant and requires authentication', async () => {
    await request(app.getHttpServer()).get('/v1/payments').expect(401);
    const result = await request(app.getHttpServer()).get('/v1/payments')
      .set('Authorization', `Bearer ${keys.other}`).expect(200);
    expect(result.body.merchant.id).toBe(merchants.other);
    expect(result.body.payments.length).toBeGreaterThan(0);
    expect(result.body.payments.length).toBeLessThanOrEqual(100);
    expect(result.body.payments.every((p: { merchant_id: string }) => p.merchant_id === merchants.other)).toBe(true);
  });
});

describe('Authenticated payment lookup and audit history', () => {
  it('returns ordered complete history after permitted state changes', async () => {
    const created = await post().expect(201);
    await db.query("UPDATE public.payments SET status='PAID' WHERE id=$1", [created.body.id]);
    await db.query("UPDATE public.payments SET status='PARTIALLY_REFUNDED' WHERE id=$1", [created.body.id]);
    await db.query("UPDATE public.payments SET status='REFUNDED' WHERE id=$1", [created.body.id]);
    const result = await request(app.getHttpServer()).get(`/v1/payments/${created.body.id}`)
      .set('Authorization', `Bearer ${keys.active}`).expect(200);
    expect(result.body.status).toBe('REFUNDED');
    expect(result.body.history.map((h: { to_status: string }) => h.to_status)).toEqual(['PENDING', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED']);
    expect(result.body.history.map((h: { from_status: string | null }) => h.from_status)).toEqual([null, 'PENDING', 'PAID', 'PARTIALLY_REFUNDED']);
    for (const event of result.body.history) expect(Number.isNaN(Date.parse(event.changed_at))).toBe(false);
  });
  it('replays original PENDING response even after the payment advances', async () => {
    const body = payload(), idempotency = randomUUID();
    const created = await post(body, idempotency).expect(201);
    await db.query("UPDATE public.payments SET status='PAID' WHERE id=$1", [created.body.id]);
    const repeated = await post(body, idempotency).expect(201);
    expect(repeated.body).toEqual(created.body);
  });
  it('returns 404 for an unknown valid UUID', async () => {
    await request(app.getHttpServer()).get(`/v1/payments/${randomUUID()}`)
      .set('Authorization', `Bearer ${keys.active}`).expect(404);
  });
  it('returns 400 for malformed UUIDs instead of a database error', async () => {
    await request(app.getHttpServer()).get('/v1/payments/not-a-uuid')
      .set('Authorization', `Bearer ${keys.active}`).expect(400);
  });
});

describe('Database enforcement of the authoritative seven-state workflow', () => {
  for (const from of states) for (const to of states) {
    it(`${from} -> ${to}: ${from === to ? 'no-op without audit duplication' : allowed[from].includes(to) ? 'allowed' : 'rejected'}`, async () => {
      await rollback(async client => {
        const id = await insertPending(client);
        for (const status of paths[from]) await client.query('UPDATE public.payments SET status=$1 WHERE id=$2', [status, id]);
        const before = await client.query('SELECT count(*)::int AS n FROM public.payment_status_history WHERE payment_id=$1', [id]);
        if (from === to || allowed[from].includes(to)) {
          await client.query('UPDATE public.payments SET status=$1 WHERE id=$2', [to, id]);
          const after = await client.query('SELECT count(*)::int AS n FROM public.payment_status_history WHERE payment_id=$1', [id]);
          expect(after.rows[0].n).toBe(before.rows[0].n + (from === to ? 0 : 1));
          const current = await client.query('SELECT status FROM public.payments WHERE id=$1', [id]);
          expect(current.rows[0].status).toBe(to);
        } else {
          await expect(client.query('UPDATE public.payments SET status=$1 WHERE id=$2', [to, id])).rejects.toMatchObject({ code: '23514' });
        }
      });
    });
  }
  it.each(states.filter(s => s !== 'PENDING'))('rejects creation directly in %s', async status => {
    await rollback(async client => {
      await expect(insertPending(client, status)).rejects.toMatchObject({ code: '23514' });
    });
  });
  it.each([
    "id=gen_random_uuid()", "merchant_id=gen_random_uuid()", "merchant_order_id='rewritten'", "amount_paisa=1",
    "currency='USD'", "success_url='https://changed.example.test'", "cancel_url='https://changed.example.test'",
    "idempotency_key='rewritten-key'", "request_fingerprint=repeat('b',64)",
    "created_at=created_at + interval '1 second'", "expires_at=expires_at + interval '1 second'",
  ])('rejects rewriting immutable payment detail: %s', async assignment => {
    await rollback(async client => {
      const id = await insertPending(client);
      await expect(client.query(`UPDATE public.payments SET ${assignment} WHERE id=$1`, [id])).rejects.toMatchObject({ code: '23514' });
    });
  });
  it('rejects manually appended fabricated history', async () => {
    await rollback(async client => {
      const id = await insertPending(client);
      await expect(client.query(`INSERT INTO public.payment_status_history(payment_id,from_status,to_status,reason)
        VALUES ($1,'PENDING','PAID','fabricated event')`, [id])).rejects.toMatchObject({ code: '23514' });
    });
  });
  it('rejects editing existing history', async () => {
    await rollback(async client => {
      const id = await insertPending(client);
      await expect(client.query("UPDATE public.payment_status_history SET reason='rewritten' WHERE payment_id=$1", [id])).rejects.toMatchObject({ code: '23514' });
    });
  });
});
