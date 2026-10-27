// Additive fictional showcase; never creates a preset login or prints credentials.
import pg from 'pg';
import { seedMerchantSamples } from '../dist/showcase/showcase-seed.js';
const database = process.env.DATABASE_URL;
if (!database)
  throw new Error('DATABASE_URL is required in the process environment');
const pool = new pg.Pool({
  connectionString: database,
  connectionTimeoutMillis: 10000,
});
try {
  await pool.query(`INSERT INTO merchants(business_name,email,status) VALUES('Riverbank Craft Studio','riverbank@paybd.example.test','ACTIVE')
    ON CONFLICT(email) DO NOTHING`);
  const merchant = (
    await pool.query(
      "SELECT id FROM merchants WHERE email='riverbank@paybd.example.test'",
    )
  ).rows[0];
  const result = await seedMerchantSamples(
    pool,
    merchant.id,
    process.env.PAYBD_CHECKOUT_BASE_URL ?? 'http://localhost:3001',
  );
  console.log(
    result.skipped
      ? 'M8 showcase retained: merchant is inactive.'
      : result.created
        ? 'M8 fictional showcase added; all balances and notifications are simulated.'
        : 'M8 showcase already present; existing records retained.',
  );
} catch {
  console.error(
    'M8 sample seed failed. Check migrations and database connectivity; no credentials displayed.',
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
