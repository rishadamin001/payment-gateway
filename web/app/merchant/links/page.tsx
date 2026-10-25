"use client";
import Image from "next/image";
import { useEffect, useState, type FormEvent } from "react";
import { merchantCall } from "../page";
import {
  BillingError,
  BillingShell,
  localDate,
  paisa,
  taka,
} from "./billing-ui";

type PaymentLink = {
  id: string;
  title: string;
  amount_paisa: number;
  currency: string;
  reusable: boolean;
  expires_at: string;
  status: string;
  payment_url: string;
  created_at: string;
};
export default function PaymentLinks() {
  const [links, setLinks] = useState<PaymentLink[]>([]),
    [selected, setSelected] = useState<PaymentLink | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    merchantCall("links")
      .then((r) => setLinks(r.links))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget,
      fields = new FormData(form);
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const link = await merchantCall("links", {
        title: fields.get("title"),
        amount_paisa: paisa(String(fields.get("amount"))),
        expires_at: new Date(String(fields.get("expires_at"))).toISOString(),
        reusable: fields.get("usage") === "reusable",
      });
      setLinks((await merchantCall("links")).links);
      setSelected(link);
      setNotice(
        "Payment link created. Copy its address or download its QR image.",
      );
      form.reset();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <BillingShell title="Payment links">
      <BillingError message={error} />
      {notice && <p role="status">{notice}</p>}
      <div className="billing-grid">
        <section className="merchant-card">
          <h2>Create a payment link</h2>
          <p>
            Use a one-time link for a single order, or a reusable link for
            repeated demo purchases. Past expiry dates can demonstrate an
            expired link.
          </p>
          <form onSubmit={create}>
            <label>
              Link title
              <input
                name="title"
                required
                maxLength={120}
                placeholder="Campus tote bag"
              />
            </label>
            <label>
              Amount (taka)
              <input
                name="amount"
                required
                inputMode="decimal"
                placeholder="450.00"
              />
            </label>
            <label>
              Expires at (local time)
              <input name="expires_at" type="datetime-local" required />
            </label>
            <label>
              Usage
              <select name="usage">
                <option value="once">Once only</option>
                <option value="reusable">Reusable</option>
              </select>
            </label>
            <button disabled={busy} className="button primary">
              {busy ? "Creating…" : "Create payment link"}
            </button>
          </form>
          {selected && (
            <section
              className="billing-entry"
              aria-label="Selected payment link"
            >
              <h3>{selected.title} · QR code</h3>
              <Image
                unoptimized
                width={220}
                height={220}
                className="billing-qr"
                src={`/api/merchant/links/${selected.id}/qr`}
                alt={`QR code for ${selected.title}`}
              />
              <label>
                Shareable link
                <input
                  className="billing-url"
                  value={selected.payment_url}
                  readOnly
                  onFocus={(e) => e.target.select()}
                />
              </label>
              <div className="billing-actions">
                <button
                  className="button secondary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(selected.payment_url);
                      setNotice("Payment link copied.");
                    } catch {
                      setNotice("Select and copy the shareable link above.");
                    }
                  }}
                >
                  Copy link
                </button>
                <a
                  className="button secondary"
                  href={`/api/merchant/links/${selected.id}/qr`}
                  download={`paybd-link-${selected.id}.png`}
                >
                  Download QR image
                </a>
              </div>
              <small>
                Localhost links open on this computer. Sharing across devices
                requires a reachable demo host.
              </small>
            </section>
          )}
        </section>
        <section className="merchant-card">
          <h2>Your payment links</h2>
          <button
            className="button secondary"
            onClick={async () => {
              try {
                setLinks((await merchantCall("links")).links);
                setError("");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Refresh links
          </button>
          {loading ? (
            <p>Loading links…</p>
          ) : !links.length ? (
            <p>No payment links yet. Create your first demo link.</p>
          ) : (
            links.map((link) => (
              <article
                className="billing-entry"
                key={link.id}
                data-link-id={link.id}
              >
                <h3>{link.title}</h3>
                <span className="billing-status">{link.status}</span>
                <p>
                  {taka(link.amount_paisa)} ·{" "}
                  {link.reusable ? "Reusable" : "One-time"}
                </p>
                <p>Expires {localDate(link.expires_at)} (Dhaka)</p>
                <div className="billing-actions">
                  <a className="button primary" href={link.payment_url}>
                    Open payment link
                  </a>
                  <button
                    className="button secondary"
                    onClick={() => setSelected(link)}
                  >
                    Show QR
                  </button>
                </div>
              </article>
            ))
          )}
        </section>
      </div>
    </BillingShell>
  );
}
