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
page.on('pageerror', error => errors.push(error.message));

try {
  await page.goto(`${origin}/merchant`);
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByLabel('Business name', { exact: true }).fill('Browser M5 store');
  await page.getByLabel('Email', { exact: true }).fill(`browser-m5-${randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill(randomBytes(20).toString('hex'));
  await page.getByRole('button', { name: 'Sign up', exact: true }).click();
  await page.getByRole('heading', { name: 'Browser M5 store', exact: true }).waitFor();

  await Promise.all([
    page.waitForResponse(response => response.url() === `${origin}/api/merchant/webhooks`),
    page.getByRole('link', { name: 'Webhooks', exact: true }).click(),
  ]);
  await page.getByLabel('Enable signed webhooks', { exact: true }).check();
  await page.getByRole('combobox').selectOption('fail_twice');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Webhook settings saved.' }).waitFor();

  await page.getByRole('link', { name: '← Merchant dashboard', exact: true }).click();
  await page.getByRole('button', { name: 'Create demo payment', exact: true }).click();
  await page.waitForURL('**/checkout/**');
  const id = page.url().split('/').at(-1);
  await page.getByRole('button', { name: 'Continue with Demo card', exact: true }).click();
  await page.getByLabel('Practice OTP', { exact: true }).fill('000000');
  await page.getByRole('button', { name: 'Confirm simulated payment', exact: true }).click();
  await page.getByRole('heading', { name: 'Payment successful', exact: true }).waitFor();

  await page.goto(`${origin}/merchant/payments/${id}`);
  await page.getByRole('heading', { name: 'Simulated refunds', exact: true }).waitFor();
  const amount = page.getByLabel('Refund amount (taka, blank = all remaining)', { exact: true });
  await amount.fill('500.00');
  await page.getByLabel('Reason', { exact: true }).fill('Fictional partial return');
  await page.getByRole('button', { name: 'Confirm demo refund', exact: true }).click();
  await page.getByText('Refunded: ৳500.00 · Remaining: ৳1000.00', { exact: true }).waitFor();
  await page.locator('.merchant-timeline').getByText('PAID → PARTIALLY_REFUNDED', { exact: true }).waitFor();
  assert.equal(await amount.inputValue(), '');

  await page.getByLabel('Reason', { exact: true }).fill('Fictional remaining return');
  await page.getByRole('button', { name: 'Confirm demo refund', exact: true }).click();
  await page.getByText('Refunded: ৳1500.00 · Remaining: ৳0.00', { exact: true }).waitFor();
  await page.locator('.merchant-timeline').getByText('PARTIALLY_REFUNDED → REFUNDED', { exact: true }).waitFor();
  assert.equal(await page.locator('.merchant-timeline li').count(), 4);
  assert.equal(await page.getByText('REQUESTED → SUCCEEDED', { exact: true }).count(), 2);
  assert.equal(await page.getByRole('button', { name: 'Confirm demo refund', exact: true }).count(), 0);
  await page.reload();
  await page.getByText('Refunded: ৳1500.00 · Remaining: ৳0.00', { exact: true }).waitFor();

  await page.goto(`${origin}/merchant/webhooks`);
  await page.waitForFunction(() => {
    const statuses = [...document.querySelectorAll('[data-event-status]')];
    return statuses.length === 6 && statuses.every(node => node.dataset.eventStatus === 'DELIVERED');
  }, undefined, { timeout: 45000 });
  const events = page.locator('article');
  assert.equal(await events.count(), 6);
  for (const event of await events.all()) {
    const attempts = await event.locator('li').allTextContents();
    assert.equal(attempts.length, 3);
    assert.match(attempts[0], /Attempt 1 · HTTP 503/);
    assert.match(attempts[1], /Attempt 2 · HTTP 503/);
    assert.match(attempts[2], /Attempt 3 · HTTP 200/);
    assert.ok(attempts.every(attempt => attempt.includes('Signature verified')));
  }
  assert.equal(await page.getByRole('main').getByRole('alert').count(), 0);
  const screenshots = new URL('../../test-results/', import.meta.url);
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL('m5-webhooks.png', screenshots)), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  console.log('PASS M5 browser signup, webhook settings, simulated checkout, partial/full refunds, persistent timeline, signed retry delivery log and mobile width.');
} finally {
  await browser.close();
}
