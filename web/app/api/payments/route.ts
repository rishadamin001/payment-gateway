import { apiError, gateway } from '@/lib/gateway';

export async function GET() {
  return gateway('/v1/payments');
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  // Next may normalize request.url to its bind address. Compare the browser
  // origin against trusted configuration and the original Host instead.
  const allowedOrigins = process.env.PAYBD_WEB_ORIGIN
    ? [process.env.PAYBD_WEB_ORIGIN]
    : ['http://localhost:3001', 'http://127.0.0.1:3001'];
  if (!origin || !allowedOrigins.includes(origin) ||
      new URL(origin).host !== request.headers.get('host') ||
      request.headers.get('sec-fetch-site') === 'cross-site') {
    return apiError('Payment requests must come from this demo workspace.', 403);
  }
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
    return apiError('A JSON payment request is required.', 415);
  }
  const reader = request.body?.getReader();
  if (!reader) return apiError('A payment request is required.', 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 8192) {
        await reader.cancel();
        return apiError('Payment request is too large.', 413);
      }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return gateway('/v1/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': request.headers.get('idempotency-key') ?? '',
      },
      body: JSON.stringify(body),
    });
  } catch {
    return apiError('The payment request must contain valid JSON.', 400);
  }
}
