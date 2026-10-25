import { demoGateway, validId } from "@/lib/demo-gateway";
import { apiError } from "@/lib/gateway";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!validId(id)) return apiError("Invalid payment link.", 400);
  return demoGateway(`/v1/pay/${id}`);
}
