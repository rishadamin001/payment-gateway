import { demoPost } from '@/lib/demo-gateway';
export async function POST(request: Request) { return demoPost(request, '/v1/shop/orders', true); }
