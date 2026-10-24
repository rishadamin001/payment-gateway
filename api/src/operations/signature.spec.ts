import { it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { signWebhook, verifyWebhook } from './signature.js';
it('authenticates exact body bytes and timestamp with constant-time comparison', () => {
  const secret = randomBytes(32).toString('hex'),
    time = '1792848000',
    now = Number(time) * 1000,
    body = Buffer.from('{"a":1}');
  const sig = signWebhook(secret, time, body);
  expect(verifyWebhook(secret, time, body, sig, now)).toBe(true);
  expect(verifyWebhook(secret, time, Buffer.from('{"a":2}'), sig, now)).toBe(
    false,
  );
  expect(verifyWebhook(secret, time, body, sig, now + 301000)).toBe(false);
  expect(verifyWebhook(secret, time, body, 'bad', now)).toBe(false);
  expect(verifyWebhook(secret, time, body, sig.slice(2), now)).toBe(false);
});
