import 'server-only';

const noStore = { 'Cache-Control': 'no-store' };

export function apiError(message: string, status: number): Response {
  return Response.json({ message }, { status, headers: noStore });
}

// This application is a local classroom workspace for one demo merchant.
// The test key stays in this server process; it is never sent to the browser.
export async function gateway(path: string, init: RequestInit = {}): Promise<Response> {
  const key = process.env.PAYBD_DEMO_API_KEY;
  if (!key) return apiError('The demo workspace is not connected. Start it with the project development launcher.', 503);
  try {
    const response = await fetch(new URL(path, process.env.PAYBD_API_BASE_URL ?? 'http://127.0.0.1:3000'), {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${key}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const messages: Record<number, string> = {
        400: 'Check the payment ID, order reference and amount. Use a positive amount with no more than two decimal places.',
        401: 'The demo merchant key is unavailable or revoked. Restart the development workspace.',
        403: 'This demo merchant is not active.',
        404: 'Payment not found in this merchant workspace.',
        409: 'This request was already used with different payment details. Create a new request.',
      };
      return apiError(messages[response.status] ?? 'The payment service is temporarily unavailable. Please retry.', response.status < 500 ? response.status : 503);
    }
    return Response.json(await response.json(), { status: response.status, headers: noStore });
  } catch {
    // Never return connection strings, request headers, or upstream exception details.
    return apiError('The payment service is unavailable. Check that the development workspace is running, then retry.', 503);
  }
}
