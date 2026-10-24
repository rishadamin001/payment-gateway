import pg from 'pg';

// Reads existing DATABASE_URL from the process environment; never reads .env directly.
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});

// Idle-client errors are otherwise emitted as uncaught EventEmitter errors.
// Do not log driver error objects: they may contain SQL parameters or credentials.
pool.on('error', () => {
  console.error('Database connection interrupted; the next request will reconnect.');
});
