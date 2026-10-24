import { demoPost, validId } from '@/lib/demo-gateway';
import { apiError } from '@/lib/gateway';
export async function POST(request: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params;
  if (!validId(id) || !['challenge', 'confirm', 'cancel', 'expire'].includes(action)) return apiError('Invalid checkout request.', 400);
  return demoPost(request, `/v1/checkout/${id}/${action}`);
}
