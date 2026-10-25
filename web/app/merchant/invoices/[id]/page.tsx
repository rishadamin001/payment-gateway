import { Suspense } from "react";
import Invoice from "./view";
async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Invoice id={id} />;
}
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p>Opening invoice…</p>}>
      <InvoicePage params={params} />
    </Suspense>
  );
}
