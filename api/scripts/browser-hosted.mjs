// Cloud test only: ephemeral self-signed HTTPS proxy, no certificate files or credentials logged.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createServer as httpsServer } from 'node:https';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { chromium } from 'playwright-core';
import { hashPassword } from '../dist/merchant/merchant-utils.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for additive hosted test fixtures.');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const origin = 'https://localhost:3443';
const email = `hosted-${randomUUID()}@example.test`;
const password = randomBytes(24).toString('hex');
let service, proxy, browser, phase = 'fixture';
try {
  await pool.query('INSERT INTO admin_accounts(email,password_hash) VALUES($1,$2)', [email, await hashPassword(password)]);
  phase = 'launcher spawn';
  service = spawn(process.execPath, ['scripts/hosted.mjs'], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    env: { ...process.env, PAYBD_PUBLIC_URL: origin, PORT: '10000', PAYBD_HOSTED_KEY_SEED: randomBytes(32).toString('hex'), PAYBD_ADMIN_EMAIL: email, PAYBD_ADMIN_PASSWORD: password },
    stdio: 'ignore',
  });
  phase = 'ephemeral HTTPS certificate';
  // Generated solely for localhost testing and retained only in this process's memory.
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = privateKey.export({ type: 'pkcs8', format: 'pem' });
  // A real pipe is needed here: /dev/stdin cannot reopen Node's socket-backed stdio.
  const cert = execFileSync('bash', ['-c', 'cat | openssl req -x509 -new -key /dev/stdin -days 1 -subj /CN=localhost -addext subjectAltName=DNS:localhost'], { input: key, stdio: ['pipe', 'pipe', 'ignore'] });
  proxy = httpsServer({ key, cert }, (req, res) => {
    const upstream = http.request({ hostname: '127.0.0.1', port: 10000, path: req.url, method: req.method, headers: { ...req.headers, 'x-forwarded-proto': 'https' } }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(503); res.end(); });
    req.pipe(upstream);
  });
  await new Promise(done => proxy.listen(3443, '127.0.0.1', done));
  phase = 'hosted startup';
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (service.exitCode !== null) throw new Error();
    try { const r = await fetch('http://127.0.0.1:10000/health'); if (r.ok && (await r.json()).database === 'connected') { ready = true; break; } } catch { /* readiness retry */ }
    await new Promise(done => setTimeout(done, 500));
  }
  assert.ok(ready);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', args: ['--no-sandbox'] });
  // Trust bypass is confined to this ephemeral local test certificate, never public hosting.
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  phase = 'HTTPS shop checkout';
  await page.goto(origin + '/shop');
  await page.getByRole('button', { name: /^Add .* to cart$/ }).first().click();
  await page.getByRole('button', { name: /^Pay ৳/ }).click();
  await page.waitForURL('**/checkout/*');
  assert.equal(new URL(page.url()).origin, origin);
  await page.getByRole('button', { name: 'Continue with Demo card', exact: true }).click();
  await page.getByLabel('Practice OTP', { exact: true }).fill('000000');
  await page.getByRole('button', { name: 'Confirm simulated payment', exact: true }).click();
  await page.getByRole('link', { name: 'Return to shop receipt', exact: true }).click();
  await page.locator('[data-status="PAID"]').waitFor();
  phase = 'HTTPS merchant session and public checkout URL';
  const merchantEmail = `hosted-merchant-${randomUUID()}@example.test`;
  const signup = await context.request.post(origin + '/api/merchant/signup', { headers: { Origin: origin }, data: { email: merchantEmail, password: randomBytes(24).toString('hex'), business_name: 'Hosted fictional workshop' } });
  assert.equal(signup.status(), 201);
  assert.ok(signup.headers()['set-cookie'].includes('Secure'));
  const payment = await context.request.post(origin + '/api/merchant/demo-payment', { headers: { Origin: origin, 'Idempotency-Key': randomUUID() }, data: { amount_paisa: 150000, currency: 'BDT', merchant_order_id: 'HOSTED-CHECK', success_url: origin + '/merchant', cancel_url: origin + '/merchant' } });
  assert.equal(payment.status(), 201);
  assert.match((await payment.json()).id, /^[0-9a-f-]{36}$/);
  const link = await context.request.post(origin + '/api/merchant/links', { headers: { Origin: origin }, data: { title: 'Hosted classroom link', amount_paisa: 150000, expires_at: new Date(Date.now() + 86400000).toISOString(), reusable: false } });
  assert.equal(link.status(), 201);
  const linked = await link.json();
  assert.equal(new URL(linked.payment_url).origin, origin);
  const checkout = await context.request.post(origin + `/v1/pay/${linked.id}/checkout`, { headers: { Origin: origin, 'Idempotency-Key': randomUUID() }, data: {} });
  assert.equal(checkout.status(), 201);
  assert.equal(new URL((await checkout.json()).checkout_url).origin, origin);
  await page.goto(origin + '/merchant');
  await page.getByRole('heading', { name: 'Hosted fictional workshop', exact: true }).waitFor();
  phase = 'hosted administrator protection';
  const setup = await context.request.post(origin + '/api/admin/setup', { headers: { Origin: origin }, data: { email, password } });
  assert.equal(setup.status(), 403);
  const login = await context.request.post(origin + '/api/admin/login', { headers: { Origin: origin }, data: { email, password } });
  assert.equal(login.status(), 201);
  assert.ok(login.headers()['set-cookie'].includes('Secure'));
  assert.equal((await context.request.get(origin + '/api/admin/me')).status(), 200);
  phase = 'same-origin Swagger and API';
  await page.goto(origin + '/docs');
  await page.locator('.swagger-ui .info .title').waitFor();
  assert.equal(new URL(page.url()).origin, origin);
  assert.ok((await page.locator('.swagger-ui .opblock').count()) >= 40);
  assert.equal((await context.request.get(origin + '/openapi.json')).status(), 200);
  assert.deepEqual(errors, []);
  console.log('PASS hosted HTTPS checkout/receipt, public checkout URL, Secure merchant/admin cookies, blocked public admin setup, same-origin Swagger and health.');
} catch (error) { console.error(`Hosted browser failed during ${phase} (${error.name}, code ${error.code ?? error.status ?? 'none'}); no credentials displayed.`); process.exitCode = 1; }
finally {
  await browser?.close();
  if (proxy) { proxy.closeAllConnections(); await new Promise(done => proxy.close(done)); }
  if (service && service.exitCode === null) { const exited = new Promise(done => service.once('exit', done)); service.kill('SIGTERM'); await exited; }
  await pool.end();
}
