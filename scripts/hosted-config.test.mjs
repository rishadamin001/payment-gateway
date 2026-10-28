import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostedConfig } from './hosted-config.mjs';
const input = { DATABASE_URL: 'postgresql://localhost/demo', RENDER_EXTERNAL_URL: 'https://paybd.example.test', PAYBD_HOSTED_KEY_SEED: 'test-only-fixture-'.repeat(3) };
test('hosted URLs agree and the test key survives restarts without exposing the seed', () => {
  const first = hostedConfig(input), second = hostedConfig(input);
  assert.equal(first.PAYBD_WEB_ORIGIN, input.RENDER_EXTERNAL_URL);
  assert.equal(first.PAYBD_CHECKOUT_BASE_URL, input.RENDER_EXTERNAL_URL);
  assert.equal(first.PAYBD_API_BASE_URL, 'http://127.0.0.1:3000');
  assert.match(first.PAYBD_DEMO_API_KEY, /^paybd_test_[A-Za-z0-9_-]{43}$/);
  assert.equal(first.PAYBD_DEMO_API_KEY, second.PAYBD_DEMO_API_KEY);
  assert.equal(first.PAYBD_HOSTED, '1');
  assert.equal(first.PORT, '10000');
  assert.equal(hostedConfig({ ...input, PAYBD_PUBLIC_URL: 'https://custom.example.test' }).PAYBD_WEB_ORIGIN, 'https://custom.example.test');
});
test('public hosting rejects unsafe origins, missing settings and a conflicting API port', () => {
  for (const origin of ['', 'http://example.test', 'https://user:password@example.test', 'https://example.test/path', 'https://example.test/?x=1', 'https://example.test/#fragment']) {
    assert.throws(() => hostedConfig({ ...input, RENDER_EXTERNAL_URL: origin }));
  }
  for (const change of [{ DATABASE_URL: '' }, { PAYBD_HOSTED_KEY_SEED: 'short' }, { PORT: '3000' }, { PORT: '-1' }, { PORT: 'NaN' }]) assert.throws(() => hostedConfig({ ...input, ...change }));
});
