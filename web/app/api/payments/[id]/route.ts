import { apiError, gateway } from '@/lib/gateway';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) {
    return apiError('Enter a valid payment ID.', 400);
  }
  return gateway(`/v1/payments/${encodeURIComponent(id)}`);
}
