import { demoGateway, validId } from '@/lib/demo-gateway';
import { apiError } from '@/lib/gateway';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return validId(id) ? demoGateway(`/v1/shop/orders/${id}`, {}, true) : apiError('Invalid order reference.', 400);
}
