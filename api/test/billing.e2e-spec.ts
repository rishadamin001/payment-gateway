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

if (!process.env.TEST_DATABASE_URL)
  throw new Error('TEST_DATABASE_URL required');
if (new URL(process.env.TEST_DATABASE_URL).pathname !== '/payment_gateway_test')
  throw new Error(
    'Billing tests require the separate payment_gateway_test database',
  );
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.PAYBD_WEBHOOK_WORKER = '0';
const db = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
let app: INestApplication, apiPool: pg.Pool;
let cookie = '',
  other = '';
const future = () => new Date(Date.now() + 86400000).toISOString();
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
const publicGet = (id: string) =>
  request(app.getHttpServer()).get(`/v1/pay/${id}`);
const checkout = (id: string, key = randomUUID()) =>
  request(app.getHttpServer())
    .post(`/v1/pay/${id}/checkout`)
    .set('Idempotency-Key', key)
    .send({});
async function link(reusable = false) {
  return (
    await post('links', {
      title: 'Fictional M6 class purchase',
      amount_paisa: 12500,
      expires_at: future(),
      reusable,
    }).expect(201)
  ).body;
}
const invoiceBody = () => ({
  customer_name: 'Nadia Demo',
  customer_email: 'nadia@example.test',
  due_at: future(),
  items: [
    { description: 'Notebook set', quantity: 2, unit_amount_paisa: 12500 },
    { description: 'Delivery', quantity: 1, unit_amount_paisa: 5000 },
  ],
});
async function invoice() {
  return (await post('invoices', invoiceBody()).expect(201)).body;
}
async function finish(id: string, outcome = 'success') {
  const challenge = await request(app.getHttpServer())
    .post(`/v1/checkout/${id}/challenge`)
    .send({ method: 'bkash' })
    .expect(200);
  return request(app.getHttpServer())
    .post(`/v1/checkout/${id}/confirm`)
    .send({
      challenge_id: challenge.body.challenge_id,
      code: '000000',
      outcome,
    })
    .expect(200);
}
function binary(path: string, session = cookie) {
  return get(path, session)
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
      res.on('error', (error: Error) => callback(error, Buffer.alloc(0)));
    });
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
  for (let i = 0; i < 2; i++) {
    const response = await post(
      'signup',
      {
        business_name: 'M6 fictional merchant',
        email: `billing-${randomUUID()}@example.test`,
        password: randomBytes(24).toString('hex'),
      },
      '',
    ).expect(201);
    const session = response.headers['set-cookie'][0].split(';')[0];
    if (i === 0) cookie = session;
    else other = session;
  }
}, 30000);
afterAll(async () => {
  await app?.close();
  await apiPool?.end();
  await db.end();
});

it('requires merchant sessions and protects mutations against foreign origins', async () => {
  await get('links', '').expect(401);
  await get('invoices', '').expect(401);
  await post(
    'links',
    {
      title: 'Unauthorized',
      amount_paisa: 1,
      expires_at: future(),
      reusable: false,
    },
    '',
  ).expect(401);
  await request(app.getHttpServer())
    .post('/v1/merchant/invoices')
    .set('Cookie', cookie)
    .set('Origin', 'https://example.com')
    .send(invoiceBody())
    .expect(403);
});
it('validates link amounts, expiry, title and mode', async () => {
  const body = {
    title: 'Demo',
    amount_paisa: 100,
    expires_at: future(),
    reusable: false,
  };
  for (const invalid of [
    { amount_paisa: 1.5 },
    { amount_paisa: 0 },
    { title: '' },
    { expires_at: 'not-a-date' },
    { reusable: 'yes' },
  ])
    await post('links', { ...body, ...invalid }).expect(400);
});
it('returns a shareable link and scoped QR image without exposing private merchant data', async () => {
  const created = await link();
  expect(created).toMatchObject({
    amount_paisa: 12500,
    reusable: false,
    status: 'ACTIVE',
  });
  expect(new URL(created.payment_url).pathname).toBe(`/pay/${created.id}`);
  const visible = await publicGet(created.id).expect(200);
  expect(visible.body.can_pay).toBe(true);
  expect(visible.body.customer_email).toBeUndefined();
  expect(visible.body.signing_secret).toBeUndefined();
  expect(
    (await get('links')).body.links.some(
      (l: { id: string }) => l.id === created.id,
    ),
  ).toBe(true);
  expect((await get('links', other)).body.links).toHaveLength(0);
  const qr = await binary(`links/${created.id}/qr`).expect(200);
  expect(qr.headers['content-type']).toContain('image/png');
  expect(Buffer.from(qr.body).subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  await get(`links/${created.id}/qr`, other).expect(404);
});
it('serializes concurrent one-time checkouts and prevents a second payment after success', async () => {
  const created = await link();
  const responses = await Promise.all(
    Array.from({ length: 12 }, () => checkout(created.id)),
  );
  expect(responses.every((r) => r.status === 201)).toBe(true);
  const ids = new Set(responses.map((r) => r.body.id));
  expect(ids.size).toBe(1);
  const paid = await finish(responses[0].body.id);
  expect(paid.body.status).toBe('PAID');
  expect((await publicGet(created.id)).body).toMatchObject({
    status: 'PAID',
    can_pay: false,
  });
  await checkout(created.id).expect(409);
});
it('allows a new one-time checkout after a failed attempt without changing the old payment', async () => {
  const created = await link();
  const first = await checkout(created.id).expect(201);
  await finish(first.body.id, 'failure');
  const second = await checkout(created.id).expect(201);
  expect(second.body.id).not.toBe(first.body.id);
  expect((await get(`payments/${first.body.id}`)).body.status).toBe('FAILED');
});
it('keeps reusable link idempotency while allowing distinct customers to pay', async () => {
  const created = await link(true),
    key = randomUUID();
  const duplicates = await Promise.all(
    Array.from({ length: 8 }, () => checkout(created.id, key)),
  );
  expect(duplicates.every((r) => r.status === 201)).toBe(true);
  expect(new Set(duplicates.map((r) => r.body.id)).size).toBe(1);
  const first = duplicates[0].body.id;
  await finish(first);
  const second = await checkout(created.id).expect(201);
  expect(second.body.id).not.toBe(first);
  expect((await publicGet(created.id)).body.can_pay).toBe(true);
});
it('blocks expired links and malformed or missing public IDs', async () => {
  const created = (
    await post('links', {
      title: 'Expired fictional link',
      amount_paisa: 100,
      expires_at: '2000-01-01T00:00:00Z',
      reusable: false,
    }).expect(201)
  ).body;
  expect((await publicGet(created.id)).body).toMatchObject({
    status: 'EXPIRED',
    can_pay: false,
  });
  const expired = await checkout(created.id);
  expect([409, 410]).toContain(expired.status);
  await publicGet('invalid').expect(400);
  await publicGet(randomUUID()).expect(404);
});
it('computes invoice totals from integer line items and rejects invalid or client-supplied totals', async () => {
  const created = await invoice();
  expect(created).toMatchObject({
    amount_paisa: 30000,
    status: 'DRAFT',
    payment_url: null,
  });
  expect(created.items).toHaveLength(2);
  const body = invoiceBody();
  for (const items of [
    [],
    [{ description: 'Demo', quantity: 0, unit_amount_paisa: 100 }],
    [{ description: 'Demo', quantity: 1.5, unit_amount_paisa: 100 }],
    [{ description: 'Demo', quantity: 1, unit_amount_paisa: 1.1 }],
  ])
    await post('invoices', { ...body, items }).expect(400);
  await post('invoices', { ...body, amount_paisa: 1 }).expect(400);
  await post('invoices', { ...body, customer_email: 'invalid' }).expect(400);
});
it('scopes invoice details, sending, reminders and PDF downloads to the owner', async () => {
  const created = await invoice();
  await get(`invoices/${created.id}`, other).expect(404);
  await post(`invoices/${created.id}/send`, {}, other).expect(404);
  await post(`invoices/${created.id}/remind`, {}, other).expect(404);
  await get(`invoices/${created.id}/pdf`, other).expect(404);
  const pdf = await binary(`invoices/${created.id}/pdf`).expect(200);
  expect(pdf.headers['content-type']).toContain('application/pdf');
  expect(Buffer.from(pdf.body).subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.headers['content-disposition']).toContain('.pdf');
});
it('sends one invoice link even with concurrent sends and tracks in-app reminders', async () => {
  const created = await invoice();
  await post(`invoices/${created.id}/remind`).expect(409);
  const sent = await Promise.all(
    Array.from({ length: 6 }, () => post(`invoices/${created.id}/send`)),
  );
  expect(sent.every((r) => r.status === 201)).toBe(true);
  expect(new Set(sent.map((r) => r.body.link_id)).size).toBe(1);
  expect(sent[0].body.status).toBe('SENT');
  const reminded = await post(`invoices/${created.id}/remind`).expect(201);
  expect(reminded.body.reminders).toHaveLength(1);
  expect(
    (await get('invoices')).body.invoices.some(
      (i: { id: string }) => i.id === created.id,
    ),
  ).toBe(true);
});
it('marks a sent invoice overdue from its due time and paid only after actual checkout', async () => {
  const created = (
    await post('invoices', {
      ...invoiceBody(),
      due_at: '2000-01-01T00:00:00Z',
    }).expect(201)
  ).body;
  const sent = (await post(`invoices/${created.id}/send`).expect(201)).body;
  expect((await get(`invoices/${created.id}`)).body.status).toBe('OVERDUE');
  const payment = await checkout(sent.link_id).expect(201);
  expect(payment.body.amount_paisa).toBe(30000);
  await finish(payment.body.id);
  expect((await get(`invoices/${created.id}`)).body.status).toBe('PAID');
  await post(`invoices/${created.id}/remind`).expect(409);
  await checkout(sent.link_id).expect(409);
});
