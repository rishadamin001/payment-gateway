import { demoGateway } from '@/lib/demo-gateway';
export async function GET() { return demoGateway('/v1/shop/catalog'); }
