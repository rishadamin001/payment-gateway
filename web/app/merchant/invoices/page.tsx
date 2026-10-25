"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { merchantCall } from "../page";
import {
  BillingError,
  BillingShell,
  localDate,
  paisa,
  taka,
} from "../links/billing-ui";
type Item = { description: string; quantity: string; price: string };
type Invoice = {
  id: string;
  customer_name: string;
  customer_email: string;
  amount_paisa: number;
  status: string;
  due_at: string;
};
export default function Invoices() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]),
    [items, setItems] = useState<Item[]>([
      { description: "", quantity: "1", price: "" },
    ]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    merchantCall("invoices")
      .then((r) => setInvoices(r.invoices))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  function change(index: number, key: keyof Item, value: string) {
    setItems((rows) =>
      rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    );
  }
  let total = 0;
  try {
    total = items.reduce(
      (sum, item) => sum + paisa(item.price) * Number(item.quantity),
      0,
    );
  } catch {
    total = 0;
  }
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const fields = new FormData(e.currentTarget);
      const invoice = await merchantCall("invoices", {
        customer_name: fields.get("customer_name"),
        customer_email: fields.get("customer_email"),
        due_at: new Date(String(fields.get("due_at"))).toISOString(),
        items: items.map((item) => ({
          description: item.description,
          quantity: Number(item.quantity),
          unit_amount_paisa: paisa(item.price),
        })),
      });
      router.push(`/merchant/invoices/${invoice.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <BillingShell title="Invoices">
      <BillingError message={error} />
      <section className="merchant-card">
        <h2>Create a draft invoice</h2>
        <p>
          Enter a fictional customer and line items. Sending makes a payment
          link available; reminders are recorded in-app only.
        </p>
        <form onSubmit={create}>
          <div className="merchant-filters">
            <label>
              Customer name
              <input name="customer_name" required maxLength={120} />
            </label>
            <label>
              Customer email
              <input
                name="customer_email"
                type="email"
                required
                maxLength={254}
              />
            </label>
            <label>
              Due at (local time)
              <input name="due_at" type="datetime-local" required />
            </label>
          </div>
          <h3>Line items</h3>
          {items.map((item, index) => (
            <div className="billing-items" key={index}>
              <label>
                Description {index + 1}
                <input
                  required
                  maxLength={160}
                  value={item.description}
                  onChange={(e) => change(index, "description", e.target.value)}
                />
              </label>
              <label>
                Quantity {index + 1}
                <input
                  type="number"
                  required
                  min="1"
                  max="10000"
                  step="1"
                  value={item.quantity}
                  onChange={(e) => change(index, "quantity", e.target.value)}
                />
              </label>
              <label>
                Unit price {index + 1} (taka)
                <input
                  required
                  inputMode="decimal"
                  value={item.price}
                  onChange={(e) => change(index, "price", e.target.value)}
                />
              </label>
              <button
                type="button"
                className="button secondary"
                disabled={items.length === 1}
                aria-label={`Remove line item ${index + 1}`}
                onClick={() =>
                  setItems((rows) => rows.filter((_, i) => i !== index))
                }
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button secondary"
            disabled={items.length >= 20}
            onClick={() =>
              setItems([
                ...items,
                { description: "", quantity: "1", price: "" },
              ])
            }
          >
            Add line item
          </button>
          <p className="billing-total">Invoice total: {taka(total)}</p>
          <button disabled={busy} className="button primary">
            {busy ? "Creating…" : "Create draft invoice"}
          </button>
        </form>
      </section>
      <section className="merchant-card">
        <h2>Your invoices</h2>
        <button
          className="button secondary"
          onClick={async () => {
            try {
              setInvoices((await merchantCall("invoices")).invoices);
              setError("");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Refresh invoices
        </button>
        {loading ? (
          <p>Loading invoices…</p>
        ) : !invoices.length ? (
          <p>No invoices yet. Create a draft to start.</p>
        ) : (
          <div className="merchant-table">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>Due (Dhaka)</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id} data-invoice-id={invoice.id}>
                    <td>{invoice.customer_name}</td>
                    <td>{taka(invoice.amount_paisa)}</td>
                    <td>
                      <span className="billing-status">{invoice.status}</span>
                    </td>
                    <td>{localDate(invoice.due_at)}</td>
                    <td>
                      <Link href={`/merchant/invoices/${invoice.id}`}>
                        Open invoice
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </BillingShell>
  );
}
