import { chromium } from 'playwright-core';
import { randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const origin = 'http://localhost:3001';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
let phase = 'signup';
page.on('pageerror', (error) => errors.push(error.message));
async function pay() {
  await page
    .getByRole('button', { name: 'Pay in demo mode', exact: true })
    .click();
  await page.waitForURL('**/checkout/**');
  await page
    .getByRole('button', { name: 'Continue with Demo card', exact: true })
    .click();
  await page.getByLabel('Practice OTP', { exact: true }).fill('000000');
  await page
    .getByRole('button', { name: 'Confirm simulated payment', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'Payment successful', exact: true })
    .waitFor();
  await page
    .getByRole('link', { name: 'Return to payment link', exact: true })
    .click();
  await page.waitForURL('**/pay/**');
}
try {
  await page.goto(`${origin}/merchant`);
  await page
    .getByRole('button', { name: 'Create an account', exact: true })
    .click();
  await page
    .getByLabel('Business name', { exact: true })
    .fill('Browser M6 store');
  await page
    .getByLabel('Email', { exact: true })
    .fill(`browser-m6-${randomUUID()}@example.test`);
  await page
    .getByLabel('Password', { exact: true })
    .fill(randomBytes(24).toString('hex'));
  await page.getByRole('button', { name: 'Sign up', exact: true }).click();
  await page
    .getByRole('heading', { name: 'Browser M6 store', exact: true })
    .waitFor();

  phase = 'payment link and QR';
  await page.getByRole('link', { name: 'Payment links', exact: true }).click();
  await page
    .getByLabel('Link title', { exact: true })
    .fill('Classroom book bundle');
  await page.getByLabel('Amount (taka)', { exact: true }).fill('125.50');
  await page
    .getByLabel('Expires at (local time)', { exact: true })
    .fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
  await page.getByRole('combobox').selectOption({ label: 'Once only' });
  await page
    .getByRole('button', { name: 'Create payment link', exact: true })
    .click();
  const linkCard = page
    .locator('[data-link-id]')
    .filter({ hasText: 'Classroom book bundle' });
  await linkCard.waitFor();
  const linkId = await linkCard.getAttribute('data-link-id');
  const shareUrl = await linkCard
    .getByRole('link', { name: 'Open payment link', exact: true })
    .getAttribute('href');
  assert.equal(new URL(shareUrl, origin).pathname, `/pay/${linkId}`);
  await linkCard.getByRole('button', { name: 'Show QR', exact: true }).click();
  await page.locator('img[alt*="QR"]').waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('img[alt*="QR"]')].every(
      (image) => image.complete && image.naturalWidth > 0,
    ),
  );
  const qr = await page.request.get(
    `${origin}/api/merchant/links/${linkId}/qr`,
  );
  assert.equal(qr.status(), 200);
  assert.deepEqual(
    (await qr.body()).subarray(0, 8),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  const [qrDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download QR image', exact: true }).click(),
  ]);
  assert.ok(qrDownload.suggestedFilename().endsWith('.png'));
  await page.goto(new URL(shareUrl, origin).href);
  await pay();
  await page.goto(`${origin}/pay/${linkId}`);
  await page.getByText('PAID', { exact: true }).waitFor();

  phase = 'invoice creation, PDF and reminder';
  await page.goto(`${origin}/merchant/invoices`);
  await page.getByLabel('Customer name', { exact: true }).fill('Nadia Demo');
  await page
    .getByLabel('Customer email', { exact: true })
    .fill('nadia@example.test');
  await page
    .getByLabel('Due at (local time)', { exact: true })
    .fill('2020-01-01T10:00');
  await page.getByLabel('Description 1', { exact: true }).fill('Notebook set');
  await page.getByLabel('Quantity 1', { exact: true }).fill('2');
  await page.getByLabel('Unit price 1 (taka)', { exact: true }).fill('125.00');
  await page
    .getByRole('button', { name: 'Add line item', exact: true })
    .click();
  await page.getByLabel('Description 2', { exact: true }).fill('Delivery');
  await page.getByLabel('Quantity 2', { exact: true }).fill('1');
  await page.getByLabel('Unit price 2 (taka)', { exact: true }).fill('50.00');
  await page
    .getByRole('button', { name: 'Create draft invoice', exact: true })
    .click();
  await page.waitForURL(/\/merchant\/invoices\/[a-f0-9-]+$/);
  const invoiceId = page.url().split('/').at(-1);
  await page
    .locator('[data-invoice-status]')
    .filter({ hasText: 'DRAFT' })
    .waitFor();
  assert.match(await page.getByRole('main').innerText(), /300\.00/);
  const pdf = await page.request.get(
    `${origin}/api/merchant/invoices/${invoiceId}/pdf`,
  );
  assert.equal(pdf.status(), 200);
  assert.equal((await pdf.body()).subarray(0, 5).toString(), '%PDF-');
  const [pdfDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download PDF', exact: true }).click(),
  ]);
  assert.ok(pdfDownload.suggestedFilename().endsWith('.pdf'));
  await page.getByRole('button', { name: 'Send invoice', exact: true }).click();
  await page
    .locator('[data-invoice-status]')
    .filter({ hasText: 'OVERDUE' })
    .waitFor();
  await page
    .getByRole('button', { name: 'Add in-app reminder', exact: true })
    .click();
  await page
    .getByRole('status')
    .filter({ hasText: 'Reminder recorded in-app. No email or SMS was sent.' })
    .waitFor();
  assert.equal(await page.locator('.billing-reminders li').count(), 1);
  const invoicePaymentUrl = await page
    .getByRole('link', { name: 'Open invoice payment link', exact: true })
    .getAttribute('href');
  phase = 'invoice payment and mobile';
  await page.goto(new URL(invoicePaymentUrl, origin).href);
  await pay();
  await page.goto(`${origin}/merchant/invoices/${invoiceId}`);
  await page
    .locator('[data-invoice-status]')
    .filter({ hasText: 'PAID' })
    .waitFor();
  assert.equal(await page.getByRole('main').getByRole('alert').count(), 0);
  const screenshots = new URL('../../test-results/', import.meta.url);
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({
    path: fileURLToPath(new URL('m6-invoice.png', screenshots)),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS M6 browser link creation, QR image, hosted checkout, invoice line items/PDF, overdue reminder, paid status and mobile width.',
  );
} catch {
  console.error(`M6 browser failed during ${phase}; no credentials displayed.`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
