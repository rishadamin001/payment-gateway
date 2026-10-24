import { Suspense } from 'react';
import Checkout from '../components/checkout';
async function CheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Checkout id={id} />;
}
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<p className="loading-message">Opening demo checkout…</p>}><CheckoutPage params={params} /></Suspense>;
}
