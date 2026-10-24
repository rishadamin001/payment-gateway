// Applies numbered migrations without resetting or deleting existing records.
// Reads DATABASE_URL only from the process environment; never logs connection details.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';

class MigrationError extends Error {}
const migrationDirectory = new URL('./migrations/', import.meta.url);
const lockId = '465000001';
let stage = 'initialization';

// SQL files remain usable directly in psql/pgAdmin. Only remove an outer
// transaction wrapper, never BEGIN/END inside a PL/pgSQL function body.
function transactionBody(sql) {
  const unwrapped = sql.replace(/^(\s*(?:--[^\n]*(?:\n|$)\s*)*)BEGIN\s*;/i, '$1');
  if (unwrapped === sql) return sql;
  if (!/COMMIT\s*;\s*$/i.test(unwrapped)) {
    throw new MigrationError('An outer BEGIN requires a final COMMIT in the migration.');
  }
  return unwrapped.replace(/COMMIT\s*;\s*$/i, '');
}

async function migrate() {
  if (!process.env.DATABASE_URL) {
    throw new MigrationError('DATABASE_URL must be set in the process environment.');
  }
  const entries = (await readdir(migrationDirectory)).filter((name) => name.endsWith('.sql')).sort();
  if (!entries.length || entries.some((name) => !/^\d{3}_[a-z0-9_]+\.sql$/.test(name))) {
    throw new MigrationError('Expected numbered SQL files such as 001_merchants_baseline.sql.');
  }
  const migrations = await Promise.all(entries.map(async (name, index) => {
    const version = Number(name.slice(0, 3));
    if (version !== index + 1) throw new MigrationError('Migration numbers must be consecutive and start at 001.');
    const sql = await readFile(new URL(name, migrationDirectory), 'utf8');
    return { name, version, checksum: createHash('sha256').update(sql).digest('hex'), sql: transactionBody(sql) };
  }));
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  let client;
  let locked = false;
  let transaction = false;
  try {
    stage = 'database connection';
    client = await pool.connect();
    await client.query('SET statement_timeout = 60000');
    await client.query('SELECT pg_advisory_lock($1::bigint)', [lockId]);
    locked = true;
    stage = 'migration ledger';
    await client.query(`CREATE TABLE IF NOT EXISTS public.paybd_schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const applied = await client.query('SELECT version, name, checksum FROM public.paybd_schema_migrations ORDER BY version');
    for (const row of applied.rows) {
      const migration = migrations.find((candidate) => candidate.version === row.version);
      if (!migration || migration.name !== row.name || migration.checksum !== row.checksum) {
        throw new MigrationError('An applied migration is missing or has changed. Restore the original file and add a new numbered migration.');
      }
    }
    for (const migration of migrations) {
      stage = migration.name;
      if (applied.rows.some((row) => row.version === migration.version)) {
        console.log(`Already applied: ${migration.name}`);
        continue;
      }
      await client.query('BEGIN');
      transaction = true;
      await client.query(migration.sql);
      await client.query(
        'INSERT INTO public.paybd_schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
        [migration.version, migration.name, migration.checksum],
      );
      await client.query('COMMIT');
      transaction = false;
      console.log(`Applied: ${migration.name}`);
    }
    console.log('Migrations complete — existing records preserved.');
  } finally {
    if (client) {
      if (transaction) await client.query('ROLLBACK').catch(() => {});
      if (locked) await client.query('SELECT pg_advisory_unlock($1::bigint)', [lockId]).catch(() => {});
      client.release();
    }
    await pool.end();
  }
}

try {
  await migrate();
} catch (error) {
  const detail = error instanceof MigrationError
    ? error.message
    : `Database or filesystem operation failed${/^[A-Z0-9]{5}$/.test(error?.code ?? '') ? ` (code ${error.code})` : ''}.`;
  console.error(`Migration failed during ${stage}: ${detail}`);
  process.exitCode = 1;
}
