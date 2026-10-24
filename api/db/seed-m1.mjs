// Fictional MIS465 fixtures. No real money, cards, PINs, OTPs or providers.
// DATABASE_URL and PAYBD_DEMO_API_KEY must come from the process environment.
import { createHash } from 'node:crypto';
import pg from 'pg';

class SeedError extends Error {}
const hash = (value) => createHash('sha256').update(value).digest('hex');
const merchants = [
  { name: 'PayBD Demo Electronics', email: 'electronics@paybd.example.test', status: 'ACTIVE' },
  { name: 'Chattogram Fashion House', email: 'fashion@paybd.example.test', status: 'ACTIVE' },
  { name: 'Dhaka Books & More', email: 'books@paybd.example.test', status: 'ACTIVE' },
  { name: 'Pending Demo Merchant', email: 'review@paybd.example.test', status: 'PENDING' },
];
// Each active merchant receives 28 payments, including all seven states.
const statuses = [
  'PAID', 'PAID', 'PAID', 'PENDING', 'FAILED', 'PAID', 'CANCELLED',
  'PAID', 'EXPIRED', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'PENDING', 'PAID',
];
const statusPath = {
  PENDING: [], PAID: ['PAID'], FAILED: ['FAILED'], CANCELLED: ['CANCELLED'],
  EXPIRED: ['EXPIRED'], PARTIALLY_REFUNDED: ['PAID', 'PARTIALLY_REFUNDED'],
  REFUNDED: ['PAID', 'REFUNDED'],
};
let stage = 'initialization';

async function seed() {
  const databaseUrl = process.env.DATABASE_URL;
  const demoKey = process.env.PAYBD_DEMO_API_KEY;
  if (!databaseUrl) throw new SeedError('DATABASE_URL must be set in the process environment.');
  if (!demoKey || !/^paybd_test_[A-Za-z0-9_-]{43}$/.test(demoKey)) {
    throw new SeedError('PAYBD_DEMO_API_KEY must be a generated 32-byte PayBD test key in the process environment.');
  }
  const pool = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
  let client;
  let transaction = false;
  try {
    stage = 'database connection';
    client = await pool.connect();
    await client.query('BEGIN');
    transaction = true;
    await client.query('SET LOCAL statement_timeout = 60000');
    // Serialize repeated/concurrent seeds, including classroom key rotation.
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', ['465000002']);
    const merchantIds = [];
    stage = 'fictional merchants';
    for (const merchant of merchants) {
      await client.query(
        `INSERT INTO public.merchants (business_name, email, status)
         VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING`,
        [merchant.name, merchant.email, merchant.status],
      );
      const result = await client.query('SELECT id, status FROM public.merchants WHERE email = $1', [merchant.email]);
      if (!result.rows[0] || result.rows[0].status !== merchant.status) {
        throw new SeedError('An existing demo merchant has a different status. Existing records were left unchanged.');
      }
      merchantIds.push(result.rows[0].id);
    }

    stage = 'sandbox key registration';
    const keyHash = hash(demoKey);
    await client.query(
      `INSERT INTO public.merchant_api_keys (merchant_id, name, mode, key_prefix, key_hash)
       VALUES ($1, 'MIS465 local sandbox', 'TEST', 'paybd_test_', $2)
       ON CONFLICT (key_hash) DO NOTHING`,
      [merchantIds[0], keyHash],
    );
    const existingKey = await client.query(
      'SELECT merchant_id, mode, revoked_at FROM public.merchant_api_keys WHERE key_hash = $1', [keyHash],
    );
    const key = existingKey.rows[0];
    if (!key || key.merchant_id !== merchantIds[0] || key.mode !== 'TEST' || key.revoked_at !== null) {
      throw new SeedError('The supplied test key is revoked or belongs to another merchant. Use a new test key; no key was reassigned.');
    }
    // Only keys registered by this seed are rotated. Other merchant keys are untouched.
    await client.query(
      `UPDATE public.merchant_api_keys SET revoked_at = now()
       WHERE merchant_id = $1 AND name = 'MIS465 local sandbox'
         AND key_hash <> $2 AND revoked_at IS NULL`,
      [merchantIds[0], keyHash],
    );

    stage = 'fictional payments';
    let added = 0;
    const now = Date.now();
    for (let i = 0; i < 84; i++) {
      const merchantId = merchantIds[i % 3];
      const merchantPaymentIndex = Math.floor(i / 3);
      const orderId = `DEMO-M1-${String(i + 1).padStart(4, '0')}`;
      const amount = 4500 + ((i * 17329) % 498000);
      const status = statuses[merchantPaymentIndex % statuses.length];
      const age = status === 'PENDING'
        ? (i % 15) * 60000
        : (Math.floor(merchantPaymentIndex / 2) + 1) * 86400000 + (i % 4) * 3600000;
      const createdAt = new Date(now - age);
      const expiresAt = new Date(createdAt.getTime() + 30 * 60000);
      const input = {
        amount_paisa: amount,
        currency: 'BDT',
        merchant_order_id: orderId,
        success_url: 'http://localhost:3001/demo/success',
        cancel_url: 'http://localhost:3001/demo/cancel',
      };
      const result = await client.query(
        `INSERT INTO public.payments
           (merchant_id, merchant_order_id, amount_paisa, currency, status,
            success_url, cancel_url, idempotency_key, request_fingerprint,
            created_at, updated_at, expires_at)
         VALUES ($1,$2,$3,'BDT','PENDING',$4,$5,$6,$7,$8,$8,$9)
         ON CONFLICT (merchant_id, idempotency_key) DO NOTHING RETURNING id`,
        [merchantId, orderId, amount, input.success_url, input.cancel_url,
         `seed-m1-${orderId}`, hash(JSON.stringify(input)), createdAt, expiresAt],
      );
      if (result.rows.length === 0) continue;
      added++;
      for (const next of statusPath[status]) {
        await client.query('UPDATE public.payments SET status = $1 WHERE id = $2', [next, result.rows[0].id]);
      }
    }
    await client.query('COMMIT');
    transaction = false;
    console.log('PayBD Demo seed completed — DEMO MODE: no real money.');
    console.log(`Four fictional merchants available; ${added} new simulated payments inserted (84 on a fresh database).`);
    console.log('Each active seed merchant has all seven states on a fresh database. Existing payments are never reset.');
    console.log('Test API key registered by SHA-256 hash; no key printed or written to disk.');
  } finally {
    if (client) {
      if (transaction) await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
    await pool.end();
  }
}

try {
  await seed();
} catch (error) {
  const detail = error instanceof SeedError
    ? error.message
    : `Database operation failed${/^[A-Z0-9]{5}$/.test(error?.code ?? '') ? ` (code ${error.code})` : ''}.`;
  console.error(`Seed failed during ${stage}: ${detail}`);
  process.exitCode = 1;
}
