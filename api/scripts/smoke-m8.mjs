import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
const base = 'http://127.0.0.1:3000';
let cookie = '',
  phase = 'signup';
async function call(path, body) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Cookie: cookie,
      Origin: 'http://localhost:3001',
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  assert.ok(response.ok, `HTTP ${response.status}`);
  if (response.headers.has('set-cookie'))
    cookie = response.headers.get('set-cookie').split(';')[0];
  return response.json();
}
const merchant = (path, body) => call('/v1/merchant/' + path, body);
try {
  await merchant('signup', {
    business_name: 'M8 smoke fictional workshop',
    email: `smoke-m8-${randomUUID()}@example.test`,
    password: randomBytes(24).toString('hex'),
  });
  phase = 'repeatable showcase examples';
  const first = await merchant('demo-data', {});
  assert.equal(first.created, true);
  assert.ok(first.counts.payments >= 20);
  const total = (await merchant('payments')).total;
  const again = await merchant('demo-data', {});
  assert.equal(again.created, false);
  assert.deepEqual(again.counts, first.counts);
  assert.equal((await merchant('payments')).total, total);
  assert.equal((await merchant('finance/reconciliation')).status, 'MATCHED');
  assert.deepEqual(
    (await merchant('invoices')).invoices.map((i) => i.status).sort(),
    ['DRAFT', 'OVERDUE', 'PAID', 'SENT'],
  );
  assert.ok(
    (await merchant('links')).links.some((l) => l.status === 'EXPIRED'),
  );
  assert.ok((await merchant('webhooks/events')).events.length > 0);
  phase = 'OpenAPI and local Swagger';
  const document = await call('/openapi.json');
  assert.match(document.openapi, /^3\./);
  for (const path of [
    '/health',
    '/merchants',
    '/v1/payments',
    '/v1/payments/{id}',
    '/v1/merchant/demo-data',
    '/v1/merchant/links',
    '/v1/merchant/invoices',
    '/v1/merchant/finance/reconciliation',
    '/v1/admin/transactions',
  ])
    assert.ok(document.paths[path], path);
  assert.ok(document.paths['/v1/merchant/demo-data'].post.security?.length);
  const schemes = Object.values(document.components.securitySchemes);
  assert.ok(schemes.some((s) => s.type === 'http' && s.scheme === 'bearer'));
  assert.ok(
    schemes.some(
      (s) =>
        s.type === 'apiKey' && s.in === 'cookie' && s.name === 'paybd_session',
    ),
  );
  assert.ok(
    schemes.some(
      (s) =>
        s.type === 'apiKey' &&
        s.in === 'cookie' &&
        s.name === 'paybd_admin_session',
    ),
  );
  const schemas = Object.values(document.components.schemas);
  assert.ok(
    schemas.some((s) => s.properties?.amount_paisa?.type === 'integer'),
  );
  const docs = await fetch(base + '/docs', {
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(docs.status, 200);
  assert.match(await docs.text(), /swagger-ui/);
  await merchant('logout', {});
  console.log(
    'PASS M8 live repeatable samples, populated invoices/links/webhooks, matched reconciliation, OpenAPI auth/amount schemas and local Swagger UI.',
  );
} catch {
  console.error(`M8 smoke failed during ${phase}; no credentials displayed.`);
  process.exitCode = 1;
}
