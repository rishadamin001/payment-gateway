import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import pg from 'pg';
import { hashPassword } from '../dist/merchant/merchant-utils.js';

if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is required for isolated demo fixtures');
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const origin = 'http://localhost:3001';
const adminEmail = `browser-admin-m7-${randomUUID()}@example.test`,
  adminPassword = randomBytes(24).toString('hex');
const errors = [];
let browser,
  phase = 'admin fixture';
try {
  await db.query(
    'INSERT INTO admin_accounts(email,password_hash) VALUES($1,$2)',
    [adminEmail, await hashPassword(adminPassword)],
  );
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({
    viewport: { width: 1400, height: 1000 },
  });
  page.on('pageerror', (error) => errors.push(error.message));
  phase = 'merchant signup';
  const business = `Browser M7 ${randomUUID().slice(0, 8)}`;
  await page.goto(`${origin}/merchant`);
  await page
    .getByRole('button', { name: 'Create an account', exact: true })
    .click();
  await page.getByLabel('Business name', { exact: true }).fill(business);
  await page
    .getByLabel('Email', { exact: true })
    .fill(`browser-m7-${randomUUID()}@example.test`);
  await page
    .getByLabel('Password', { exact: true })
    .fill(randomBytes(24).toString('hex'));
  await page.getByRole('button', { name: 'Sign up', exact: true }).click();
  await page.getByRole('heading', { name: business, exact: true }).waitFor();
  const merchantId = (
    await (await page.request.get(`${origin}/api/merchant/me`)).json()
  ).id;
  await page
    .getByRole('button', { name: 'Create demo payment', exact: true })
    .click();
  await page.waitForURL('**/checkout/**');
  const paymentId = page.url().split('/').at(-1);
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
  await page.goto(`${origin}/merchant/payments/${paymentId}`);
  await page
    .getByLabel('Refund amount (taka, blank = all remaining)', { exact: true })
    .fill('500.00');
  await page.getByLabel('Reason', { exact: true }).fill('M7 fictional return');
  await page
    .getByRole('button', { name: 'Confirm demo refund', exact: true })
    .click();
  await page
    .getByText('Refunded: ৳500.00 · Remaining: ৳1000.00', { exact: true })
    .waitFor();

  phase = 'finance ledger and settlement';
  await page.goto(`${origin}/merchant/finance`);
  await page
    .getByRole('heading', {
      name: 'Ledger, settlements & payouts',
      exact: true,
    })
    .waitFor();
  await page.locator('[data-reconciliation-status="MATCHED"]').waitFor();
  assert.match(
    await page.locator('[data-balance="available"]').innerText(),
    /1,000\.00/,
  );
  await page
    .getByLabel('Settlement amount (taka, blank = all available)', {
      exact: true,
    })
    .fill('700.00');
  await page
    .getByRole('button', { name: 'Create simulated settlement', exact: true })
    .click();
  const settlement = page.locator('[data-settlement-id]');
  await settlement.waitFor();
  await settlement
    .getByRole('button', { name: 'Simulate payout', exact: true })
    .click();
  await page
    .getByRole('status')
    .filter({ hasText: 'Simulated payout recorded.' })
    .waitFor();
  assert.match(await settlement.innerText(), /PAID_OUT/);
  assert.match(
    await page.locator('[data-balance="available"]').innerText(),
    /300\.00/,
  );
  assert.match(
    await page.locator('[data-balance="reserved"]').innerText(),
    /0\.00/,
  );
  assert.match(
    await page.locator('[data-balance="clearing"]').innerText(),
    /300\.00/,
  );
  await page.locator('[data-reconciliation-status="MATCHED"]').waitFor();
  const journal = page.locator('details').first();
  await journal.locator('summary').click();
  await journal
    .getByRole('columnheader', { name: 'Debit', exact: true })
    .waitFor();
  await journal
    .getByRole('columnheader', { name: 'Credit', exact: true })
    .waitFor();
  assert.equal(await page.getByRole('main').getByRole('alert').count(), 0);
  const screenshots = new URL('../../test-results/', import.meta.url);
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({
    path: fileURLToPath(new URL('m7-finance.png', screenshots)),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.setViewportSize({ width: 1400, height: 1000 });

  phase = 'risk fixtures';
  for (let i = 0; i < 3; i++) {
    const response = await page.request.post(
      `${origin}/api/merchant/demo-payment`,
      {
        headers: { Origin: origin, 'Idempotency-Key': randomUUID() },
        data: {
          amount_paisa: 100,
          currency: 'BDT',
          merchant_order_id: `M7-BROWSER-FAIL-${randomUUID()}`,
          success_url: origin + '/merchant',
          cancel_url: origin + '/merchant',
        },
      },
    );
    assert.equal(response.status(), 201);
    const fixture = await response.json();
    await db.query(
      "UPDATE payments SET status='FAILED' WHERE id=$1 AND merchant_id=$2",
      [fixture.id, merchantId],
    );
  }
  phase = 'admin login and review';
  await page.goto(`${origin}/admin`);
  await page
    .getByRole('heading', { name: 'Admin sign in', exact: true })
    .waitFor();
  await page.getByLabel('Admin email', { exact: true }).fill(adminEmail);
  await page.getByLabel('Admin password', { exact: true }).fill(adminPassword);
  await page
    .getByRole('button', { name: 'Sign in as admin', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'Demo administration', exact: true })
    .waitFor();
  await page.getByLabel('Search merchants', { exact: true }).fill(business);
  await page
    .getByRole('button', { name: 'Filter merchants', exact: true })
    .click();
  const merchant = page.locator(`[data-merchant-id="${merchantId}"]`);
  await merchant.waitFor();
  await merchant
    .getByLabel('Reason', { exact: true })
    .fill('Classroom approval');
  await merchant
    .getByRole('button', { name: 'Approve merchant', exact: true })
    .click();
  await page
    .getByRole('status')
    .filter({ hasText: 'Merchant approved' })
    .waitFor();
  await merchant
    .getByLabel('Reason', { exact: true })
    .fill('Classroom suspension');
  await merchant
    .getByRole('button', { name: 'Suspend merchant', exact: true })
    .click();
  await merchant.locator('[data-merchant-status="SUSPENDED"]').waitFor();
  await merchant
    .getByLabel('Reason', { exact: true })
    .fill('Resume classroom demo');
  await merchant
    .getByRole('button', { name: 'Approve merchant', exact: true })
    .click();
  await merchant.locator('[data-merchant-status="ACTIVE"]').waitFor();

  phase = 'admin transactions risk and audit';
  await page
    .getByRole('tab', { name: 'All transactions', exact: true })
    .click();
  await page.getByLabel('Merchant ID', { exact: true }).fill(merchantId);
  await page
    .getByRole('button', { name: 'Filter transactions', exact: true })
    .click();
  await page.locator(`[data-admin-payment-id="${paymentId}"]`).waitFor();
  await page.getByRole('tab', { name: 'Risk flags', exact: true }).click();
  await page.getByText(business, { exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Audit log', exact: true }).click();
  await page.getByLabel('Audit merchant ID', { exact: true }).fill(merchantId);
  await page.getByRole('button', { name: 'Filter audit', exact: true }).click();
  await page.locator('[data-audit-id]').first().waitFor();
  assert.match(
    await page.getByRole('main').innerText(),
    /merchant\.status_changed/,
  );
  assert.equal(await page.getByRole('main').getByRole('alert').count(), 0);
  await page.screenshot({
    path: fileURLToPath(new URL('m7-admin.png', screenshots)),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page
    .getByRole('button', { name: 'Sign out admin', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'Admin sign in', exact: true })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'PASS M7 browser checkout/refund, double-entry ledger, settlement/payout history, reconciliation, admin login, approval/suspension, transaction filters, risk flags, audit and mobile layout.',
  );
} catch {
  console.error(`M7 browser failed during ${phase}; no credentials displayed.`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await db.end();
}
