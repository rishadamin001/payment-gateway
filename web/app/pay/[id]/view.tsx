"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { localDate, taka } from "../../merchant/links/billing-ui";
type PaymentLink = {
  id: string;
  title: string;
  merchant_name: string;
  amount_paisa: number;
  currency: string;
  reusable: boolean;
  expires_at: string;
  status: string;
  can_pay: boolean;
};
export default function PayLink({ id }: { id: string }) {
  const router = useRouter(),
    attempt = useRef<string | null>(null);
  const [link, setLink] = useState<PaymentLink | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/pay/${id}`, { cache: "no-store" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message ?? "This link is unavailable.");
      setLink(data);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/pay/${id}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.message ?? "This link is unavailable.");
        return data;
      })
      .then((data) => {
        if (!cancelled) setLink(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);
  async function pay() {
    if (busy) return;
    setBusy(true);
    setError("");
    attempt.current ??= crypto.randomUUID();
    try {
      const r = await fetch(`/api/pay/${id}/checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": attempt.current,
        },
        body: "{}",
      });
      const data = await r.json();
      if (!r.ok)
        throw new Error(
          data.message ?? "This link could not start a checkout.",
        );
      attempt.current = null;
      router.push(`/checkout/${data.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="merchant-shell billing-shell billing-public">
      <Link href="/shop">PayBD Demo</Link>
      <p className="merchant-notice">
        DEMO MODE: no real money. Never enter real card details, PINs or OTPs.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!link && !error ? (
        <p>Loading payment link…</p>
      ) : (
        link && (
          <section className="merchant-card">
            <p>{link.merchant_name}</p>
            <h1>{link.title}</h1>
            <p className="billing-total">{taka(link.amount_paisa)}</p>
            <span className="billing-status" data-link-status={link.status}>
              {link.status}
            </span>
            <p>
              {link.reusable
                ? "Reusable payment link"
                : "One-time payment link"}
            </p>
            <small>Expires {localDate(link.expires_at)} (Dhaka)</small>
            {link.status === "PAID" ? (
              <p>
                This one-time link has already been paid. Thank you for trying
                PayBD Demo.
              </p>
            ) : link.status === "EXPIRED" ? (
              <p>
                This payment link has expired. Ask the demo merchant for a new
                link.
              </p>
            ) : (
              <p>
                Your payment will use the simulated checkout. No bank or payment
                provider is contacted.
              </p>
            )}
            <div className="billing-actions">
              <button
                className="button primary"
                disabled={busy || !link.can_pay}
                onClick={() => void pay()}
              >
                {busy ? "Opening checkout…" : "Pay in demo mode"}
              </button>
              <button className="button secondary" onClick={() => void load()}>
                Refresh status
              </button>
            </div>
          </section>
        )
      )}
    </main>
  );
}
