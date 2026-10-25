import { demoPost, validId } from "@/lib/demo-gateway";
import { apiError } from "@/lib/gateway";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!validId(id)) return apiError("Invalid payment link.", 400);
  return demoPost(request, `/v1/pay/${id}/checkout`);
}
