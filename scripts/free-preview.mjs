// Free temporary public preview; no hosting account, card, provider keys or database reset.
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import pg from '../api/node_modules/pg/lib/index.js';
import { openFreePreviewTunnel } from '../api/scripts/free-preview-transport.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let app, tunnel, stopping = false;
async function stop(code) {
  if (stopping) return;
  stopping = true;
  tunnel?.close();
  if (app && app.exitCode === null) app.kill('SIGTERM');
  process.exitCode = code;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void stop(0));
async function available(port) {
  await new Promise((done, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error('Stop the existing demo services before opening the free preview.')));
    server.listen(port, '127.0.0.1', () => server.close(done));
  });
}
async function start() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required in the process environment.');
  await available(3000);
  await available(10000);
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  let email = process.env.PAYBD_ADMIN_EMAIL;
  let password = process.env.PAYBD_ADMIN_PASSWORD;
  try {
    if (!email && !password) {
      const existing = await pool.query('SELECT email FROM admin_accounts ORDER BY created_at,id LIMIT 1');
      if (!existing.rows[0]) throw new Error('Initialize an administrator locally before sharing, or supply PAYBD_ADMIN_EMAIL and PAYBD_ADMIN_PASSWORD securely.');
      email = existing.rows[0].email;
      // Existing hosted bootstrap preserves its stored password. This random
      // value is only a valid placeholder for startup, never a new login.
      password = randomBytes(24).toString('hex');
    }
  } finally { await pool.end(); }
  console.log('Opening a free temporary HTTPS preview. Only fictional demo data may be used.');
  tunnel = await openFreePreviewTunnel({
    timeoutMs: 90000,
    async onHostname(origin) {
      if (stopping) throw new Error('Preview cancelled.');
      const env = { ...process.env, PAYBD_PUBLIC_URL: origin, PORT: '10000', PAYBD_HOSTED_KEY_SEED: process.env.PAYBD_HOSTED_KEY_SEED || randomBytes(32).toString('hex'), PAYBD_ADMIN_EMAIL: email, PAYBD_ADMIN_PASSWORD: password };
      app = spawn(process.execPath, ['scripts/hosted.mjs'], { cwd: root, env, stdio: 'inherit' });
      app.once('error', () => { console.error('The demo application could not start.'); void stop(1); });
      app.once('exit', () => { if (!stopping) { console.error('The demo stopped; the public preview is closing.'); void stop(1); } });
      for (let i = 0; i < 120 && !stopping; i++) {
        try {
          const response = await fetch('http://127.0.0.1:10000/health', { signal: AbortSignal.timeout(2000) });
          if (response.ok && (await response.json()).database === 'connected') {
            console.log(`Free DEMO MODE preview ready: ${origin}/shop`);
            console.log('This temporary URL stops working when the process or cloud workspace stops.');
            return;
          }
        } catch { /* bounded readiness retry */ }
        await new Promise(done => setTimeout(done, 500));
      }
      throw new Error('The demo did not pass its readiness check.');
    },
  });
  if (stopping) tunnel.close();
  void tunnel.closed.then(() => { if (!stopping) { console.error('The free relay disconnected; the preview is closing.'); void stop(1); } });
}
start().catch(error => {
  // Only our own fixed messages are shown, never driver errors or request data.
  const safe = ['DATABASE_URL is required in the process environment.', 'Stop the existing demo services before opening the free preview.', 'Initialize an administrator locally before sharing, or supply PAYBD_ADMIN_EMAIL and PAYBD_ADMIN_PASSWORD securely.'];
  console.error(safe.includes(error.message) ? error.message : 'Free preview could not connect. Check the relay network permission and local service readiness. No paid service was created.');
  void stop(1);
});
