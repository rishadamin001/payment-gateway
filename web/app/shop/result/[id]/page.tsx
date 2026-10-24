import { Suspense } from 'react';
import OrderResult from '../../components/result';
async function Result({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrderResult id={id} />;
}
export default function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<main className="shop-loading">Loading your demo order…</main>}><Result params={params} /></Suspense>;
}
