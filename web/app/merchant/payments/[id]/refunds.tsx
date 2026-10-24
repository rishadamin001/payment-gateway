"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { merchantCall } from "../../page";
type Data = {
  totals_known: boolean;
  refunded_paisa: number | null;
  remaining_paisa: number | null;
  payment_status: string;
  refunds: {
    id: string;
    amount_paisa: number;
    reason: string;
    status: string;
    history: { status: string; changed_at: string }[];
  }[];
};
export default function Refunds({
  id,
  onComplete,
}: {
  id: string;
  onComplete: () => void;
}) {
  const [data, setData] = useState<Data | null>(null),
    [amount, setAmount] = useState(""),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const attempt = useRef<{ body: string; key: string } | null>(null);
  useEffect(() => {
    merchantCall(`payments/${id}/refunds`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    const body: { reason: string; amount_paisa?: number } = {
      reason: reason.trim(),
    };
    if (amount) {
      if (!/^\d{1,10}(\.\d{1,2})?$/.test(amount)) {
        setError("Enter a positive taka amount with at most two decimals.");
        return;
      }
      const [whole, part = ""] = amount.split(".");
      body.amount_paisa = Number(whole) * 100 + Number(part.padEnd(2, "0"));
      if (!body.amount_paisa) {
        setError("Amount must be positive");
        return;
      }
    }
    const text = JSON.stringify(body);
    if (!attempt.current || attempt.current.body !== text)
      attempt.current = { body: text, key: crypto.randomUUID() };
    setBusy(true);
    try {
      await merchantCall(`payments/${id}/refunds`, body, attempt.current.key);
      setData(await merchantCall(`payments/${id}/refunds`));
      setAmount("");
      setReason("");
      attempt.current = null;
      onComplete();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="merchant-card">
      <h2>Simulated refunds</h2>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          {data.totals_known ? (
            <p>
              Refunded: ৳{((data.refunded_paisa ?? 0) / 100).toFixed(2)} ·
              Remaining: ৳{((data.remaining_paisa ?? 0) / 100).toFixed(2)}
            </p>
          ) : (
            <p>
              Earlier refund amounts were not recorded. Further refunds are
              unavailable for this payment.
            </p>
          )}
          {data.totals_known &&
            ["PAID", "PARTIALLY_REFUNDED"].includes(data.payment_status) && (
              <form onSubmit={submit}>
                <label>
                  Refund amount (taka, blank = all remaining)
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    inputMode="decimal"
                    placeholder="Full remaining refund"
                  />
                </label>
                <label>
                  Reason
                  <input
                    required
                    maxLength={200}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <button disabled={busy} className="button primary">
                  {busy ? "Recording refund…" : "Confirm demo refund"}
                </button>
                <p>
                  No money is sent. The refund and state change are recorded
                  atomically.
                </p>
              </form>
            )}
          <ul>
            {data.refunds.map((r) => (
              <li key={r.id}>
                <strong>
                  ৳{(r.amount_paisa / 100).toFixed(2)} · {r.status}
                </strong>
                <p>{r.reason}</p>
                <small>{r.history.map((h) => h.status).join(" → ")}</small>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
