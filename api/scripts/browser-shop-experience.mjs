// Exercises the customer journey against the running demo. Adds fictional orders
// only; natural expiry uses the real two-minute deadline, without changing data.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const origin = new URL(process.env.PAYBD_BROWSER_ORIGIN ?? 'http://localhost:3001').origin;
const target = new URL(origin);
const local = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
if (!local && !(target.protocol === 'https:' && /^[a-z0-9-]+\.tunnelmole\.net$/.test(target.hostname))) {
  throw new Error('Browser checks require loopback or an assigned HTTPS demo preview.');
}
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
  args: ['--no-sandbox'],
  ...(!local ? { proxy: { server: process.env.HTTPS_PROXY || process.env.HTTP_PROXY } } : {}),
});
const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.name));
let phase = 'catalogue';
const screenshots = new URL('../../test-results/', import.meta.url);
async function screenshot(name) {
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL(name, screenshots)), fullPage: true });
}
async function createOrder() {
  const response = await context.request.post(origin + '/api/shop/orders', {
    headers: { Origin: origin, 'Idempotency-Key': `shop-${randomUUID()}` },
    data: { items: [{ product_id: 'notebook', quantity: 1 }] },
  });
  assert.equal(response.status(), 201);
  return response.json();
}
async function openOrder(order) {
  phase += ' / open request';
  await page.goto(`${origin}/checkout/${order.payment_id}`);
  await page.getByRole('heading', { name: 'Choose how to pay.', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Simulated outcome', { exact: true }).count(), 0);
  assert.equal(await page.locator('.checkout-test-tools[open]').count(), 0);
}
async function verifyMethod(method, label) {
  phase += ' / select method';
  if (method !== 'card') {
    await page.locator(`.checkout-method.method-${method}`).click();
  }
  phase += ' / open OTP';
  await page.getByRole('button', { name: `Continue with ${label}`, exact: true }).click();
  await page.locator(`[data-processing="${method}"]`).waitFor();
  phase += ' / fill OTP';
  await page.getByLabel('Practice OTP', { exact: true }).fill('000000');
}
async function confirmSuccess(method) {
  phase += ' / confirm';
  await page.getByRole('button', { name: 'Confirm simulated payment', exact: true }).click();
  await page.locator(`[data-processing="${method}"]`).waitFor();
  assert.equal(await page.locator('[data-payment-result="PAID"]').count(), 0);
  await page.getByRole('heading', { name: 'Payment successful', exact: true }).waitFor();
  await page.locator('[data-payment-result="PAID"]').waitFor();
}
try {
  const catalogResponse = await context.request.get(origin + '/api/shop/catalog');
  assert.equal(catalogResponse.status(), 200);
  const { products } = await catalogResponse.json();
  assert.equal(products.length, 6);
  await page.goto(origin + '/shop');
  await page.locator('.shop-product').first().waitFor();
  assert.equal(await page.locator('.shop-product').count(), 6);
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll('.shop-product-art img')];
    return images.length === 6 && images.every(image => image.complete && image.naturalWidth > 0);
  });
  const imageSources = await page.locator('.shop-product-art img').evaluateAll(images => images.map(image => image.getAttribute('src')));
  assert.equal(new Set(imageSources).size, 6);
  assert.ok(imageSources.every(src => src.startsWith('/products/')));
  const notebook = products.find(product => product.id === 'notebook');
  const notebookCard = page.locator('.shop-product').filter({ has: page.getByRole('heading', { name: notebook.name, exact: true }) });
  const notebookImage = await notebookCard.locator('img').getAttribute('src');

  phase = 'cart feedback and quantities';
  const add = page.getByRole('button', { name: `Add ${notebook.name} to cart`, exact: true });
  await add.click();
  await page.locator('.shop-cart-feedback').filter({ hasText: `${notebook.name} added to cart` }).waitFor();
  assert.match(await add.innerText(), /Added!/);
  assert.equal(await page.locator('.shop-cart-link').getAttribute('aria-label'), 'Your cart, 1 items');
  await page.getByRole('link', { name: 'View cart', exact: true }).click();
  assert.equal(new URL(page.url()).hash, '#cart');
  assert.equal(await page.getByLabel(`Quantity for ${notebook.name}`, { exact: true }).inputValue(), '1');
  await add.click();
  assert.equal(await page.getByLabel(`Quantity for ${notebook.name}`, { exact: true }).inputValue(), '2');
  await page.getByLabel(`Quantity for ${notebook.name}`, { exact: true }).selectOption('10');
  assert.equal(await add.isDisabled(), true);
  assert.match(await add.innerText(), /Max 10/);
  assert.match(await page.locator('.shop-quantity-limit').innerText(), /Maximum of 10/);
  await page.getByLabel(`Quantity for ${notebook.name}`, { exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Dismiss cart notification', exact: true }).click();
  await page.getByRole('button', { name: notebook.category, exact: true }).click();
  assert.equal(await notebookCard.locator('img').getAttribute('src'), notebookImage);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByRole('link', { name: 'Merchant dashboard', exact: true }).first().waitFor();
  assert.equal(await page.locator('.shop-merchant-link').getAttribute('href'), '/merchant');
  await screenshot('shop-experience-desktop.png');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('.shop-merchant-link').isVisible(), true);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await screenshot('shop-experience-mobile.png');
  await page.setViewportSize({ width: 1400, height: 1000 });

  phase = 'shop card payment and receipt';
  await page.getByRole('button', { name: /^Pay ৳/ }).click();
  await page.waitForURL('**/checkout/*');
  assert.equal(new URL(page.url()).origin, origin);
  const shopPaymentId = page.url().split('/').at(-1);
  await page.getByRole('heading', { name: 'Choose how to pay.', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Simulated outcome', { exact: true }).count(), 0);
  await verifyMethod('card', 'Demo card');
  await confirmSuccess('card');
  assert.match(await page.locator('.checkout-result').innerText(), new RegExp(shopPaymentId));
  await screenshot('checkout-experience-success.png');
  await page.getByRole('link', { name: 'Return to shop receipt', exact: true }).click();
  await page.locator('[data-status="PAID"]').waitFor();
  await page.goto(origin + '/shop');
  await page.locator('.shop-empty').waitFor();

  for (const [method, label] of [['bkash', 'bKash'], ['nagad', 'Nagad'], ['rocket', 'Rocket'], ['bank', 'Demo bank']]) {
    phase = `${method} processing and verified result`;
    const order = await createOrder();
    await openOrder(order);
    await verifyMethod(method, label);
    await confirmSuccess(method);
  }

  phase = 'declined result';
  await openOrder(await createOrder());
  await verifyMethod('card', 'Demo card');
  await page.locator('.checkout-test-tools summary').click();
  await page.getByRole('button', { name: 'Simulate declined payment', exact: true }).click();
  await page.locator('[data-processing="card"]').waitFor();
  await page.getByRole('heading', { name: 'Payment failed', exact: true }).waitFor();
  await page.locator('[data-payment-result="FAILED"]').waitFor();
  await screenshot('checkout-experience-failure.png');

  phase = 'cancelled result';
  await openOrder(await createOrder());
  await page.getByRole('button', { name: 'Cancel payment', exact: true }).click();
  await page.locator('[data-processing="card"]').waitFor();
  await page.getByRole('heading', { name: 'Payment cancelled', exact: true }).waitFor();
  await page.locator('[data-payment-result="CANCELLED"]').waitFor();

  phase = 'real two-minute natural expiry';
  const expiring = await createOrder();
  const initial = await context.request.get(`${origin}/api/checkout/${expiring.payment_id}`);
  assert.equal(initial.status(), 200);
  const timing = await initial.json();
  const seconds = (Date.parse(timing.expires_at) - Date.parse(timing.server_time)) / 1000;
  assert.ok(seconds > 110 && seconds <= 120);
  await openOrder(expiring);
  await page.getByLabel('Checkout time remaining', { exact: true }).waitFor();
  console.log('Checking natural expiry against the real two-minute server deadline…');
  await page.getByRole('heading', { name: 'Payment timed out', exact: true }).waitFor({ timeout: 135000 });
  await page.locator('[data-payment-result="EXPIRED"]').waitFor();
  const expired = await context.request.get(`${origin}/api/checkout/${expiring.payment_id}`);
  assert.equal((await expired.json()).status, 'EXPIRED');
  await screenshot('checkout-experience-expired.png');
  phase = 'expired result mobile layout';
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('.checkout-merchant-link').isVisible(), true);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  phase = 'reduced-motion preference';
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(origin + '/shop');
  await page.locator('.shop-product').first().waitFor();
  await page.getByRole('button', { name: `Add ${notebook.name} to cart`, exact: true }).click();
  await page.locator('.shop-toast').waitFor();
  assert.equal(await page.locator('.shop-toast').evaluate(element => getComputedStyle(element).animationName), 'none');
  assert.equal(await page.locator('.shop-product').first().evaluate(element => getComputedStyle(element).transitionDuration), '0s');
  assert.deepEqual(errors, []);
  console.log('PASS customer browser: six local images/category identity, cart toast/button/count/quantity limit, desktop/mobile merchant access, five method processing/results, default OTP approval, receipt/cart clearing, decline/cancel, real two-minute automatic expiry, reduced motion and zero page errors.');
} catch (error) {
  await screenshot('shop-experience-failure.png').catch(() => {});
  console.error(`Customer browser failed during ${phase} (${error.name}); no credentials displayed.`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
