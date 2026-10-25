"use client";
import { useCallback, useEffect, useState } from "react";
import { merchantCall } from "../../page";
import {
  BillingError,
  BillingShell,
  localDate,
  taka,
} from "../../links/billing-ui";
type Invoice = {
  id: string;
  customer_name: string;
  customer_email: string;
  amount_paisa: number;
  status: string;
  due_at: string;
  created_at: string;
  payment_url: string | null;
  items: { description: string; quantity: number; unit_amount_paisa: number }[];
  reminders: { id: string; message: string; created_at: string }[];
};
export default function InvoiceView({ id }: { id: string }) {
  const [invoice, setInvoice] = useState<Invoice | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setInvoice(await merchantCall(`invoices/${id}`));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    merchantCall(`invoices/${id}`)
      .then(setInvoice)
      .catch((e) => setError(e.message));
  }, [id]);
  async function action(name: "send" | "remind") {
    setBusy(true);
    setError("");
    try {
      setInvoice(await merchantCall(`invoices/${id}/${name}`, {}));
      setNotice(
        name === "send"
          ? "Invoice sent in demo mode. Its payment link is ready."
          : "Reminder recorded in-app. No email or SMS was sent.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <BillingShell title="Invoice details">
      <BillingError message={error} />
      {notice && <p role="status">{notice}</p>}
      {!invoice && !error ? (
        <p>Loading invoice…</p>
      ) : (
        invoice && (
          <>
            <section className="merchant-card">
              <header>
                <h2>{invoice.customer_name}</h2>
                <span
                  className="billing-status"
                  data-invoice-status={invoice.status}
                >
                  {invoice.status}
                </span>
              </header>
              <p>{invoice.customer_email}</p>
              <p>
                Invoice <code>{invoice.id}</code>
              </p>
              <p>Due {localDate(invoice.due_at)} (Dhaka)</p>
              <div className="billing-actions">
                {invoice.status === "DRAFT" && (
                  <button
                    disabled={busy}
                    className="button primary"
                    onClick={() => void action("send")}
                  >
                    Send invoice
                  </button>
                )}
                {["SENT", "OVERDUE"].includes(invoice.status) && (
                  <button
                    disabled={busy}
                    className="button secondary"
                    onClick={() => void action("remind")}
                  >
                    Add in-app reminder
                  </button>
                )}
                <a
                  className="button secondary"
                  href={`/api/merchant/invoices/${id}/pdf`}
                  download={`invoice-${id}.pdf`}
                >
                  Download PDF
                </a>
                <button
                  className="button secondary"
                  onClick={() => void load()}
                >
                  Refresh invoice
                </button>
                {invoice.payment_url && (
                  <a className="button primary" href={invoice.payment_url}>
                    Open invoice payment link
                  </a>
                )}
              </div>
              {invoice.payment_url && (
                <label>
                  Invoice payment link
                  <input
                    className="billing-url"
                    value={invoice.payment_url}
                    readOnly
                    onFocus={(e) => e.target.select()}
                  />
                </label>
              )}
              <div className="merchant-table">
                <table>
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th>Quantity</th>
                      <th>Unit price</th>
                      <th>Line total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.items.map((item, index) => (
                      <tr key={index}>
                        <td>{item.description}</td>
                        <td>{item.quantity}</td>
                        <td>{taka(item.unit_amount_paisa)}</td>
                        <td>{taka(item.unit_amount_paisa * item.quantity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="billing-total">
                Invoice total: {taka(invoice.amount_paisa)}
              </p>
              <p>
                Payment status is confirmed from the database. Refunds keep the
                invoice paid and are tracked on the payment.
              </p>
            </section>
            <section className="merchant-card">
              <h2>In-app reminders</h2>
              {invoice.reminders.length ? (
                <ul className="billing-reminders">
                  {invoice.reminders.map((reminder) => (
                    <li key={reminder.id}>
                      <p>{reminder.message}</p>
                      <small>{localDate(reminder.created_at)} (Dhaka)</small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  No reminders recorded yet. Send this invoice before adding a
                  reminder.
                </p>
              )}
            </section>
          </>
        )
      )}
    </BillingShell>
  );
}
