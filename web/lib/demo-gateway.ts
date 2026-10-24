import 'server-only';
import { apiError } from './gateway';

// Checkout links are capabilities. Never attach the merchant's key to these requests.
export async function demoGateway(path: string, init: RequestInit = {}, merchant = false): Promise<Response> {
  const headers = new Headers(init.headers);
  if (merchant) {
    const key = process.env.PAYBD_DEMO_API_KEY;
    if (!key) return apiError('Start the demo launcher to connect the shop merchant.', 503);
    headers.set('Authorization', `Bearer ${key}`);
  }
  try {
    const upstream = await fetch(new URL(path, process.env.PAYBD_API_BASE_URL ?? 'http://127.0.0.1:3000'), {
      ...init, headers, cache: 'no-store', signal: AbortSignal.timeout(10_000), redirect: 'error',
    });
    if (!upstream.ok) {
      const messages: Record<number, string> = {
        400: 'Check the request. In the practice OTP step, use only the displayed fake code.',
        401: 'The demo merchant is not connected. Restart the demo launcher.',
        403: 'This demo request is not permitted.',
        404: 'This payment or order was not found.',
        409: 'This request has changed or has already finished. Refresh its current status before retrying.',
        410: 'This practice session has expired. Refresh or start a new checkout step.',
        429: 'Too many incorrect practice codes. Start a new practice step.',
      };
      return apiError(messages[upstream.status] ?? 'The demo payment service is unavailable. Please retry.', upstream.status < 500 ? upstream.status : 503);
    }
    return Response.json(await upstream.json(), { status: upstream.status, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return apiError('The demo service is unavailable. Keep the launcher open and retry.', 503);
  }
}

export async function demoPost(request: Request, path: string, merchant = false): Promise<Response> {
  const origin = request.headers.get('origin');
  const allowed = process.env.PAYBD_WEB_ORIGIN ? [process.env.PAYBD_WEB_ORIGIN] : ['http://localhost:3001', 'http://127.0.0.1:3001'];
  try {
    if (!origin || !allowed.includes(origin) || new URL(origin).host !== request.headers.get('host') || request.headers.get('sec-fetch-site') === 'cross-site') {
      return apiError('Use this demo page to submit the request.', 403);
    }
  } catch { return apiError('Invalid request origin.', 403); }
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return apiError('A JSON request is required.', 415);
  const reader = request.body?.getReader();
  if (!reader) return apiError('A request body is required.', 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 8192) { await reader.cancel(); return apiError('Request is too large.', 413); }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return demoGateway(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': request.headers.get('idempotency-key') ?? '' }, body: JSON.stringify(body) }, merchant);
  } catch { return apiError('The request must contain valid JSON.', 400); }
}
export function validId(id: string) { return /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id); }
