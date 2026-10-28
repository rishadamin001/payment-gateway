// Single hosted Node service: public Next.js, private NestJS and local webhook worker.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { hostedConfig } from './hosted-config.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const children = new Set();
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0));
function launch(args, cwd, env, persistent = false) {
  if (stopping) throw new Error('Startup cancelled.');
  const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit' });
  children.add(child);
  return new Promise((done, reject) => {
    child.once('error', () => { reject(new Error('Could not start a hosted process.')); stop(1); });
    child.once('exit', code => {
      children.delete(child);
      if (persistent && !stopping) { console.error('A hosted service stopped; restarting the complete service is required.'); stop(1); }
      if (code === 0 && !stopping) done();
      else reject(new Error('A hosted startup task failed or was cancelled.'));
    });
    if (persistent) done();
  });
}
async function main() {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Node.js 24 is required.');
  const env = hostedConfig(process.env);
  const api = resolve(root, 'api');
  await launch(['db/migrate.mjs'], api, env);
  await launch(['db/bootstrap-hosted-admin.mjs'], api, env);
  delete env.PAYBD_ADMIN_EMAIL;
  delete env.PAYBD_ADMIN_PASSWORD;
  delete env.PAYBD_HOSTED_KEY_SEED;
  await launch(['db/seed-m1.mjs'], api, env);
  await launch(['db/seed-m8.mjs'], api, env);
  await launch(['dist/main.js'], api, { ...env, PORT: '3000', HOST: '127.0.0.1' }, true);
  let ready = false;
  for (let i = 0; i < 60 && !stopping; i++) {
    try {
      const r = await fetch('http://127.0.0.1:3000/health', { signal: AbortSignal.timeout(2000) });
      if (r.ok && (await r.json()).database === 'connected') { ready = true; break; }
    } catch { /* bounded startup retry */ }
    await new Promise(done => setTimeout(done, 500));
  }
  if (!ready) throw new Error('Hosted API did not become ready.');
  await launch(['node_modules/next/dist/bin/next', 'start', '-H', '0.0.0.0', '-p', env.PORT], resolve(root, 'web'), env, true);
  console.log('Hosted PayBD started — DEMO MODE, no real money.');
}
main().catch(() => {
  if (!stopping) console.error('Hosted startup failed. Check environment settings, migrations and service readiness. Credentials are not displayed.');
  stop(1);
});
