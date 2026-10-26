// Local MIS465 sandbox only. Generated test keys stay in process environments.
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import net from 'node:net';

const root = fileURLToPath(new URL('../', import.meta.url));
const verify = process.argv.includes('--verify');
const production = process.argv.includes('--production');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [];
const environment = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://paybd@127.0.0.1:5432/payment_gateway',
  PAYBD_DEMO_API_KEY: process.env.PAYBD_DEMO_API_KEY ?? `paybd_test_${randomBytes(32).toString('base64url')}`,
  PAYBD_CHECKOUT_BASE_URL: 'http://localhost:3001',
  PAYBD_API_BASE_URL: 'http://127.0.0.1:3000',
  PAYBD_API_URL: 'http://127.0.0.1:3000',
  NEXT_TELEMETRY_DISABLED: '1',
  PAYBD_WEBHOOK_WORKER: '1',
};
const dockerEnvironment = { ...process.env };
for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete dockerEnvironment[key];
const dockerArgs = process.platform === 'linux' ? ['--host=unix:///var/run/docker.sock'] : [];
function docker(args, quiet = false) {
  const result = spawnSync('docker', [...dockerArgs, ...args], {
    env: dockerEnvironment, encoding: 'utf8', stdio: quiet ? 'pipe' : 'inherit',
  });
  if (result.error || result.status !== 0) throw new Error('Local Docker operation failed. Check Docker Desktop/daemon and port 5432.');
  return result.stdout?.trim();
}
function run(command, args, cwd = root, env = environment) {
  return new Promise((resolvePromise, reject) => {
    if (stopping) return reject(new Error('Demo startup cancelled.'));
    const child = spawn(command, args, { cwd, env, stdio: 'inherit', detached: process.platform !== 'win32', shell: process.platform === 'win32' && command === npm });
    children.push(child);
    child.on('error', () => reject(new Error(`Could not start ${command}.`)));
    child.on('exit', (code) => code === 0 && !stopping ? resolvePromise() : reject(new Error(`${command} task failed or was cancelled (exit ${code}).`)));
  });
}
function server(command, args, cwd, env = environment) {
  if (stopping) throw new Error('Demo startup cancelled.');
  const child = spawn(command, args, { cwd, env, stdio: 'inherit', detached: process.platform !== 'win32' });
  children.push(child);
  child.on('error', () => { console.error('A demo service failed to start.'); stop(1); });
  child.on('exit', code => { if (!stopping) { console.error(`A demo service stopped (exit ${code}).`); stop(1); } });
  return child;
}
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null || !child.pid) continue;
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* process group already exited */ }
    }
  }
  process.exitCode = code;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0));
async function waitFor(url, predicate) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (stopping) throw new Error('Demo service stopped during startup.');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok && await predicate(response)) return;
    } catch { /* bounded readiness retry */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('A demo service did not pass its readiness check.');
}
async function portAvailable(port) {
  await new Promise((done, reject) => {
    const socket = net.createServer();
    socket.once('error', () => reject(new Error(`Port ${port} is occupied; stop its existing service before starting PayBD.`)));
    socket.listen(port, '127.0.0.1', () => socket.close(done));
  });
}
async function main() {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('PayBD requires Node.js 24.');
  await portAvailable(3000);
  if (!verify) await portAvailable(3001);
  if (!process.env.DATABASE_URL) {
    docker(['info', '--format', '{{.ServerVersion}}'], true);
    const existing = docker(['ps', '-a', '--filter', 'name=^/paybd-m1-postgres$', '--format', '{{.Names}}'], true);
    if (!existing) {
      docker(['run', '-d', '--name', 'paybd-m1-postgres', '--label', 'paybd.demo=m1',
        '-p', '127.0.0.1:5432:5432', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
        '-e', 'POSTGRES_USER=paybd', '-e', 'POSTGRES_DB=payment_gateway',
        '-v', 'paybd-m1-postgres18:/var/lib/postgresql', 'postgres:18-alpine']);
    } else {
      const label = docker(['inspect', '--format', '{{index .Config.Labels "paybd.demo"}}', 'paybd-m1-postgres'], true);
      if (label !== 'm1') throw new Error('An unrelated container uses the PayBD name; leaving it unchanged.');
      docker(['start', 'paybd-m1-postgres'], true);
    }
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { docker(['exec', 'paybd-m1-postgres', 'pg_isready', '-U', 'paybd', '-d', 'payment_gateway'], true); ready = true; break; } catch { await new Promise(r => setTimeout(r, 500)); }
    }
    if (!ready) throw new Error('PostgreSQL did not become ready.');
    if (verify) {
      const present = docker(['exec', 'paybd-m1-postgres', 'psql', '-U', 'paybd', '-d', 'postgres', '-tAc', "SELECT 1 FROM pg_database WHERE datname='payment_gateway_test'"], true);
      if (present !== '1') docker(['exec', 'paybd-m1-postgres', 'createdb', '-U', 'paybd', 'payment_gateway_test'], true);
      environment.TEST_DATABASE_URL ??= 'postgresql://paybd@127.0.0.1:5432/payment_gateway_test';
    }
  }
  const api = resolve(root, 'api');
  const web = resolve(root, 'web');
  await run(process.execPath, ['db/migrate.mjs'], api);
  await run(process.execPath, ['db/seed-m1.mjs'], api);
  await run(npm, ['run', 'build'], api);
  if (verify) {
    if (!environment.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL must identify a separate test database for verification.');
    await run(npm, ['test'], api, {...environment,PAYBD_WEBHOOK_WORKER:'0'});
    await run(npm, ['run', 'test:e2e'], api, {...environment,PAYBD_WEBHOOK_WORKER:'0'});
    await run(npm, ['run', 'lint'], web);
    await run(npm, ['run', 'build'], web);
  } else if (production) {
    await run(npm, ['run', 'build'], web);
  }
  server(process.execPath, ['dist/main.js'], api, { ...environment, PORT: '3000', HOST: '127.0.0.1' });
  await waitFor('http://127.0.0.1:3000/health', async r => (await r.json()).database === 'connected');
  if (verify) {
    await run(process.execPath, ['scripts/smoke-m1.mjs'], api);
    await run(process.execPath, ['scripts/smoke-m23.mjs'], api);
    await run(process.execPath, ['scripts/smoke-m4.mjs'], api);
    await run(process.execPath, ['scripts/smoke-m5.mjs'], api);
    await run(process.execPath, ['scripts/smoke-m6.mjs'], api);
    await run(process.execPath, ['scripts/smoke-m7.mjs'], api);
    console.log('M1–M7 verification completed. No real money or provider connections.');
    stop(0);
    return;
  }
  server(process.execPath, ['node_modules/next/dist/bin/next', production ? 'start' : 'dev', '-p', '3001', '-H', '127.0.0.1'], web);
  await waitFor('http://127.0.0.1:3001', async r => (await r.text()).includes('PayBD'));
  // A deliberate shop-merchant suspension must not prevent the administrator
  // from starting the app to review it. Check the public API connection here.
  await waitFor('http://127.0.0.1:3001/api/shop/catalog', async r => {
    const data = await r.json();
    return data.test_mode === true && Array.isArray(data.products) && data.products.length > 0;
  });
  console.log('PayBD Demo ready on local port 3001; API on 3000. DEMO MODE: no real money.');
  console.log('Demo shop: http://localhost:3001/shop');
  console.log('Press Ctrl+C to stop app services. Database and fictional records are retained.');
  if (process.argv.includes('--open-shop') && process.platform === 'win32') {
    const browser = spawn('cmd.exe', ['/d', '/s', '/c', 'start "" "http://localhost:3001/shop"'], { stdio: 'ignore', windowsHide: true });
    browser.on('error', () => console.log('Open localhost on port 3001, path /shop, in your browser.'));
  }
}
main().catch((error) => {
  if (stopping) return;
  // Errors here are fixed launcher messages, not driver errors or credential values.
  console.error(`PayBD setup did not complete: ${error.message}`);
  stop(1);
});
