import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
const origin = 'http://localhost:3001';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
const context = await browser.newContext({
  viewport: { width: 1400, height: 1000 },
});
const page = await context.newPage();
const errors = [],
  externalRequests = [];
page.on('pageerror', (e) => errors.push(e.message));
context.on('request', (request) => {
  const url = new URL(request.url());
  if (
    ['http:', 'https:'].includes(url.protocol) &&
    !['localhost', '127.0.0.1'].includes(url.hostname)
  )
    externalRequests.push(url.hostname);
});
let phase = 'signup';
try {
  const business = `Browser M8 ${randomUUID().slice(0, 8)}`;
  await page.goto(origin + '/merchant');
  await page
    .getByRole('button', { name: 'Create an account', exact: true })
    .click();
  await page.getByLabel('Business name', { exact: true }).fill(business);
  await page
    .getByLabel('Email', { exact: true })
    .fill(`browser-m8-${randomUUID()}@example.test`);
  await page
    .getByLabel('Password', { exact: true })
    .fill(randomBytes(24).toString('hex'));
  await page.getByRole('button', { name: 'Sign up', exact: true }).click();
  await page.getByRole('heading', { name: business, exact: true }).waitFor();
  phase = 'repeatable examples and chart';
  await page
    .getByRole('button', { name: 'Load fictional examples', exact: true })
    .click();
  await page.locator('[data-demo-data="loaded"]').waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll('.merchant-table tbody tr').length >= 20,
  );
  assert.ok(
    (await page.locator('svg[aria-label="Revenue chart"] rect').count()) >= 10,
  );
  const before = await (
    await page.request.get(origin + '/api/merchant/payments')
  ).json();
  await page
    .getByRole('button', { name: 'Load fictional examples', exact: true })
    .click();
  await page
    .getByRole('status')
    .filter({ hasText: 'Fictional examples already loaded.' })
    .waitFor();
  assert.equal(
    (await (await page.request.get(origin + '/api/merchant/payments')).json())
      .total,
    before.total,
  );
  const screenshots = new URL('../../test-results/', import.meta.url);
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({
    path: fileURLToPath(new URL('m8-dashboard.png', screenshots)),
    fullPage: true,
  });
  phase = 'populated links and invoices';
  await page.goto(origin + '/merchant/links');
  await page.locator('[data-link-id]').first().waitFor();
  assert.ok((await page.locator('[data-link-id]').count()) >= 4);
  await page.goto(origin + '/merchant/invoices');
  await page.getByRole('main').getByText('OVERDUE', { exact: true }).waitFor();
  for (const state of ['DRAFT', 'SENT', 'PAID'])
    assert.ok(
      (await page.getByRole('main').getByText(state, { exact: true }).count()) >
        0,
    );
  phase = 'populated finance and webhooks';
  await page.goto(origin + '/merchant/finance');
  await page.locator('[data-reconciliation-status="MATCHED"]').waitFor();
  assert.ok((await page.locator('[data-settlement-id]').count()) >= 2);
  await page.goto(origin + '/merchant/webhooks');
  await page.locator('[data-event-status]').first().waitFor();
  assert.ok((await page.locator('[data-event-status]').count()) > 0);
  assert.equal(await page.getByRole('main').getByRole('alert').count(), 0);
  phase = 'architecture and mobile';
  await page.goto(origin + '/architecture');
  await page.getByRole('heading', { level: 1 }).waitFor();
  const architecture = await page.getByRole('main').innerText();
  assert.match(architecture, /DEMO MODE/);
  assert.match(architecture, /PostgreSQL/);
  assert.match(architecture, /ledger/i);
  assert.match(architecture, /webhook/i);
  await page.screenshot({
    path: fileURLToPath(new URL('m8-architecture.png', screenshots)),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  phase = 'local Swagger explorer';
  const docsPage = await context.newPage();
  docsPage.on('pageerror', (e) => errors.push(e.message));
  await docsPage.goto('http://localhost:3000/docs');
  await docsPage.locator('.swagger-ui .info .title').waitFor();
  assert.match(
    await docsPage.locator('.swagger-ui .info .title').innerText(),
    /PayBD/,
  );
  await docsPage.locator('.swagger-ui .opblock').first().waitFor();
  assert.ok((await docsPage.locator('.swagger-ui .opblock').count()) >= 40);
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
  await docsPage.screenshot({
    path: fileURLToPath(new URL('m8-swagger.png', screenshots)),
    fullPage: true,
  });
  console.log(
    'PASS M8 browser repeatable samples, populated charts/links/invoices/finance/webhooks, architecture/mobile layout and locally hosted Swagger without external requests.',
  );
} catch {
  console.error(`M8 browser failed during ${phase}; no credentials displayed.`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
