import type { Pool } from 'pg';
import { credentials, hashPassword } from '../merchant/merchant-utils.js';

export async function bootstrapHostedAdmin(pool: Pool, env: NodeJS.ProcessEnv) {
  const input = credentials({ email: env.PAYBD_ADMIN_EMAIL, password: env.PAYBD_ADMIN_PASSWORD });
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(465000009)');
    const existing = await db.query('SELECT email FROM admin_accounts');
    if (existing.rowCount) {
      if (!existing.rows.some(row => row.email === input.email)) throw new Error('Administrator already provisioned');
    } else {
      const created = await db.query('INSERT INTO admin_accounts(email,password_hash) VALUES($1,$2) RETURNING id', [input.email, await hashPassword(input.password)]);
      await db.query("INSERT INTO audit_log(actor_type,actor_id,action,entity_type,entity_id) VALUES('ADMIN',$1::uuid,'admin.hosted_setup','admin_accounts',$1::text)", [created.rows[0].id]);
    }
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}
