import { createHash } from 'node:crypto';

export function hostedConfig(source) {
  let origin;
  try {
    const url = new URL(source.PAYBD_PUBLIC_URL || source.RENDER_EXTERNAL_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
    origin = url.origin;
  } catch { throw new Error('Hosted mode requires a public HTTPS origin in PAYBD_PUBLIC_URL or RENDER_EXTERNAL_URL.'); }
  if (!source.DATABASE_URL) throw new Error('Hosted mode requires DATABASE_URL from secure environment settings.');
  if (!source.PAYBD_HOSTED_KEY_SEED || source.PAYBD_HOSTED_KEY_SEED.length < 32) throw new Error('Set a generated PAYBD_HOSTED_KEY_SEED of at least 32 characters in secure environment settings.');
  const port = Number(source.PORT || 10000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 3000) throw new Error('Hosted PORT must be 1024–65535 and different from internal API port 3000.');
  return {
    ...source,
    NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', PAYBD_HOSTED: '1',
    PAYBD_WEB_ORIGIN: origin, PAYBD_CHECKOUT_BASE_URL: origin,
    PAYBD_API_BASE_URL: 'http://127.0.0.1:3000', PAYBD_API_URL: 'http://127.0.0.1:3000',
    PAYBD_WEBHOOK_WORKER: '1', PORT: String(port),
    // Stable across deployments; only the hash of this server-only test key is stored.
    PAYBD_DEMO_API_KEY: `paybd_test_${createHash('sha256').update(source.PAYBD_HOSTED_KEY_SEED).digest('base64url')}`,
  };
}
