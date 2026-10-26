import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { hashPassword } from '../dist/merchant/merchant-utils.js';

if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is required for isolated demo fixtures');
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const base = 'http://127.0.0.1:3000';
let merchantCookie = '',
  adminCookie = '',
  phase = 'admin fixture';
async function call(path, body, key = randomUUID(), expected) {
  const admin = path.startsWith('/v1/admin/');
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Cookie: admin ? adminCookie : merchantCookie,
      Origin: 'http://localhost:3001',
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (expected !== undefined) assert.equal(response.status, expected);
  else assert.ok(response.ok, `HTTP ${response.status}`);
  if (response.headers.has('set-cookie')) {
    const cookie = response.headers.get('set-cookie').split(';')[0];
    if (admin) adminCookie = cookie;
    else merchantCookie = cookie;
  }
  return response.json();
}
const merchant = (path, body, key, expected) =>
  call('/v1/merchant/' + path, body, key, expected);
const admin = (path, body, key, expected) =>
  call('/v1/admin/' + path, body, key, expected);
try {
  phase = 'first-admin setup';
  if ((await admin('setup-status')).setup_required) {
    const candidates = Array.from({ length: 2 }, () => ({
      email: `first-admin-m7-${randomUUID()}@example.test`,
      password: randomBytes(24).toString('hex'),
    }));
    const results = await Promise.all(
      candidates.map((body) =>
        fetch(base + '/v1/admin/setup', {
          method: 'POST',
          headers: {
            Origin: 'http://localhost:3001',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10000),
        }),
      ),
    );
    assert.deepEqual(
      results.map((response) => response.status).sort(),
      [201, 409],
    );
    adminCookie = results
      .find((response) => response.status === 201)
      .headers.get('set-cookie')
      .split(';')[0];
    await admin('logout', {});
    assert.equal((await admin('setup-status')).setup_required, false);
    console.log(
      'PASS M7 first-admin setup: one concurrent winner, setup closed, session logout.',
    );
  }
  phase = 'admin fixture';
  const email = `smoke-admin-m7-${randomUUID()}@example.test`,
    password = randomBytes(24).toString('hex');
  await db.query(
    'INSERT INTO admin_accounts(email,password_hash) VALUES($1,$2)',
    [email, await hashPassword(password)],
  );
  await admin('login', { email, password });
  phase = 'merchant payment and refund';
  await merchant('signup', {
    business_name: 'M7 smoke fictional merchant',
    email: `smoke-m7-${randomUUID()}@example.test`,
    password: randomBytes(24).toString('hex'),
  });
  const me = await merchant('me');
  const input = {
    amount_paisa: 25000,
    currency: 'BDT',
    merchant_order_id: `M7-SMOKE-${randomUUID()}`,
    success_url: 'http://localhost:3001/merchant',
    cancel_url: 'http://localhost:3001/merchant',
  };
  const payment = await merchant('demo-payment', input);
  const challenge = await call(`/v1/checkout/${payment.id}/challenge`, {
    method: 'bank',
  });
  await call(`/v1/checkout/${payment.id}/confirm`, {
    challenge_id: challenge.challenge_id,
    code: '000000',
    outcome: 'success',
  });
  await merchant(`payments/${payment.id}/refunds`, {
    amount_paisa: 5000,
    reason: 'M7 fictional return',
  });
  phase = 'ledger settlement and payout';
  const key = randomUUID(),
    settlement = await merchant(
      'finance/settlements',
      { amount_paisa: 15000 },
      key,
    );
  assert.equal(
    (await merchant('finance/settlements', { amount_paisa: 15000 }, key)).id,
    settlement.id,
  );
  await merchant(`finance/settlements/${settlement.id}/payout`, {});
  const finance = await merchant('finance');
  assert.deepEqual(finance.balances, {
    available_paisa: 5000,
    reserved_paisa: 0,
    clearing_paisa: 5000,
  });
  assert.equal(finance.payouts.length, 1);
  for (const journal of finance.journals) {
    assert.equal(journal.entries.length, 2);
    assert.equal(
      journal.entries.reduce(
        (n, entry) =>
          n +
          (entry.side === 'DEBIT' ? entry.amount_paisa : -entry.amount_paisa),
        0,
      ),
      0,
    );
  }
  assert.equal((await merchant('finance/reconciliation')).status, 'MATCHED');
  phase = 'admin review and audit';
  await admin(`merchants/${me.id}/status`, {
    status: 'ACTIVE',
    reason: 'Demo approval',
  });
  const transactions = await admin(`transactions?merchant_id=${me.id}`);
  assert.equal(transactions.total, 1);
  const audit = await admin(`audit?merchant_id=${me.id}`);
  assert.ok(audit.events.some((event) => event.action === 'payout.succeeded'));
  assert.ok(
    audit.events.some((event) => event.action === 'merchant.status_changed'),
  );
  await admin(`merchants/${me.id}/status`, {
    status: 'SUSPENDED',
    reason: 'Demo suspension',
  });
  await merchant(
    'demo-payment',
    { ...input, merchant_order_id: randomUUID() },
    randomUUID(),
    403,
  );
  await admin('logout', {});
  await merchant('logout', {});
  console.log(
    'PASS M7 live balanced ledger, refund, idempotent settlement, payout, reconciliation, separate admin login, approval/suspension and audit.',
  );
} catch {
  console.error(`M7 smoke failed during ${phase}; no credentials displayed.`);
  process.exitCode = 1;
} finally {
  await db.end();
}
