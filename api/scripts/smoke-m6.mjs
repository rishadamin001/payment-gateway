import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

const base = 'http://127.0.0.1:3000';
let cookie = '',
  phase = 'signup';
async function call(path, body, key = randomUUID(), binary = false) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Cookie: cookie,
      Origin: 'http://localhost:3001',
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (response.headers.has('set-cookie'))
    cookie = response.headers.get('set-cookie').split(';')[0];
  assert.ok(response.ok, `HTTP ${response.status}`);
  return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
}
const merchant = (path, body, key, binary) =>
  call('/v1/merchant/' + path, body, key, binary);
async function finish(id) {
  const challenge = await call(`/v1/checkout/${id}/challenge`, {
    method: 'nagad',
  });
  const result = await call(`/v1/checkout/${id}/confirm`, {
    challenge_id: challenge.challenge_id,
    code: '000000',
    outcome: 'success',
  });
  assert.equal(result.status, 'PAID');
}
try {
  await merchant('signup', {
    business_name: 'M6 smoke fictional merchant',
    email: `m6-smoke-${randomUUID()}@example.test`,
    password: randomBytes(24).toString('hex'),
  });
  phase = 'links and QR';
  const link = await merchant('links', {
    title: 'Fictional book purchase',
    amount_paisa: 12500,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    reusable: false,
  });
  assert.equal(new URL(link.payment_url).pathname, `/pay/${link.id}`);
  const qr = await merchant(`links/${link.id}/qr`, undefined, undefined, true);
  assert.deepEqual(
    qr.subarray(0, 8),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  const key = randomUUID();
  const payment = await call(`/v1/pay/${link.id}/checkout`, {}, key);
  assert.equal(
    (await call(`/v1/pay/${link.id}/checkout`, {}, key)).id,
    payment.id,
  );
  await finish(payment.id);
  assert.equal((await call(`/v1/pay/${link.id}`)).can_pay, false);
  phase = 'invoice, PDF and reminder';
  const invoice = await merchant('invoices', {
    customer_name: 'Nadia Demo',
    customer_email: 'nadia@example.test',
    due_at: '2020-01-01T00:00:00Z',
    items: [
      { description: 'Notebook set', quantity: 2, unit_amount_paisa: 12500 },
      { description: 'Delivery', quantity: 1, unit_amount_paisa: 5000 },
    ],
  });
  assert.equal(invoice.amount_paisa, 30000);
  assert.equal(invoice.status, 'DRAFT');
  const pdf = await merchant(
    `invoices/${invoice.id}/pdf`,
    undefined,
    undefined,
    true,
  );
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const sent = await merchant(`invoices/${invoice.id}/send`, {});
  assert.equal(sent.status, 'OVERDUE');
  const reminded = await merchant(`invoices/${invoice.id}/remind`, {});
  assert.equal(reminded.reminders.length, 1);
  const invoicePayment = await call(`/v1/pay/${sent.link_id}/checkout`, {});
  await finish(invoicePayment.id);
  assert.equal((await merchant(`invoices/${invoice.id}`)).status, 'PAID');
  await merchant('logout', {});
  console.log(
    'PASS M6 live shareable link, QR image, idempotent checkout, invoice totals/PDF, overdue reminder and paid status.',
  );
} catch {
  console.error(`M6 smoke failed during ${phase}; no credentials displayed.`);
  process.exitCode = 1;
}
