import pg from 'pg';
import { bootstrapHostedAdmin } from '../dist/admin/hosted-bootstrap.js';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
try {
  await bootstrapHostedAdmin(pool, process.env);
  console.log('Hosted administrator ready. Existing accounts and passwords are preserved.');
} catch {
  console.error('Hosted administrator setup failed. Set a valid PAYBD_ADMIN_EMAIL and a new demo-only PAYBD_ADMIN_PASSWORD (12–128 characters) securely. An existing administrator is never replaced.');
  process.exitCode = 1;
} finally { await pool.end(); }
