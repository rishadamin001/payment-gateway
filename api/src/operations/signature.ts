import { createHmac, timingSafeEqual } from 'node:crypto';
export function signWebhook(
  secret: string,
  timestamp: string,
  raw: Buffer | string,
) {
  return createHmac('sha256', secret)
    .update(timestamp + '.')
    .update(raw)
    .digest('hex');
}
export function verifyWebhook(
  secret: string,
  timestamp: string,
  raw: Buffer,
  signature: string,
  now = Date.now(),
) {
  if (
    !/^\d{10}$/.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300 ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return false;
  return timingSafeEqual(
    Buffer.from(signWebhook(secret, timestamp, raw), 'hex'),
    Buffer.from(signature, 'hex'),
  );
}
