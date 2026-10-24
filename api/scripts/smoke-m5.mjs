import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

const base = 'http://127.0.0.1:3000';
let cookie = '',
  phase = 'signup';
async function call(path, body, key = randomUUID()) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Cookie: cookie,
      Origin: 'http://localhost:3001',
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (response.headers.has('set-cookie'))
    cookie = response.headers.get('set-cookie').split(';')[0];
  assert.ok(response.ok, `HTTP ${response.status}`);
  return response.json();
}
const merchant = (path, body, key) => call('/v1/merchant/' + path, body, key);
try {
  await merchant('signup', {
    business_name: 'M5 smoke fictional merchant',
    email: `m5-smoke-${randomUUID()}@example.test`,
    password: randomBytes(24).toString('hex'),
  });
  await merchant('webhooks', { enabled: true, receiver_mode: 'fail_twice' });
  phase = 'simulated checkout';
  const payment = await merchant('demo-payment', {
    amount_paisa: 12500,
    currency: 'BDT',
    merchant_order_id: `M5-SMOKE-${randomUUID()}`,
    success_url: 'http://localhost:3001/merchant',
    cancel_url: 'http://localhost:3001/merchant',
  });
  const challenge = await call(`/v1/checkout/${payment.id}/challenge`, {
    method: 'bkash',
  });
  assert.equal(
    (
      await call(`/v1/checkout/${payment.id}/confirm`, {
        challenge_id: challenge.challenge_id,
        code: '000000',
        outcome: 'success',
      })
    ).status,
    'PAID',
  );
  phase = 'partial and full refunds';
  const path = `payments/${payment.id}/refunds`,
    key = randomUUID();
  const body = { amount_paisa: 2500, reason: 'Fictional partial return' };
  const first = await merchant(path, body, key);
  assert.equal((await merchant(path, body, key)).id, first.id);
  await merchant(path, { reason: 'Fictional remaining return' });
  const refunds = await merchant(path);
  assert.equal(refunds.refunded_paisa, 12500);
  assert.equal(refunds.remaining_paisa, 0);
  assert.equal(refunds.refunds.length, 2);
  assert.equal(refunds.payment_status, 'REFUNDED');
  assert.deepEqual(
    (await merchant(`payments/${payment.id}`)).history.map((h) => h.to_status),
    ['PENDING', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'],
  );
  phase = 'signed webhook retries';
  let events = [];
  for (let attempt = 0; attempt < 40; attempt++) {
    events = (await merchant('webhooks/events')).events;
    if (events.length === 6 && events.every((e) => e.status === 'DELIVERED'))
      break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(events.length, 6);
  assert.ok(events.every((e) => e.status === 'DELIVERED'));
  for (const event of events) {
    assert.deepEqual(
      event.deliveries.map((d) => d.http_status),
      [503, 503, 200],
    );
    assert.ok(event.deliveries.every((d) => d.signature_valid));
  }
  await merchant('logout', {});
  console.log(
    'PASS M5 live checkout, idempotent partial/full refunds, state history, six signed events and automatic retries.',
  );
} catch {
  console.error(`M5 smoke failed during ${phase}; no credentials displayed.`);
  process.exitCode = 1;
}
