import { Suspense } from "react";
import PayLink from "./view";
async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PayLink id={id} />;
}
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p>Opening payment link…</p>}>
      <PayPage params={params} />
    </Suspense>
  );
}
