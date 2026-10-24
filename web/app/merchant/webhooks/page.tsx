"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { merchantCall } from "../page";
import "../merchant.css";
type Event = {
  id: string;
  event_type: string;
  payload: { payment_id?: string; status?: string; amount_paisa?: number };
  status: string;
  attempts: number;
  next_attempt_at: string;
  deliveries: {
    attempt: number;
    http_status: number | null;
    result: string;
    signature_valid: boolean;
    created_at: string;
  }[];
};
export default function Webhooks() {
  const [enabled, setEnabled] = useState(false),
    [mode, setMode] = useState("success"),
    [events, setEvents] = useState<Event[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    merchantCall("webhooks")
      .then((s) => {
        setEnabled(s.enabled);
        setMode(s.receiver_mode);
      })
      .catch((e) => setError(e.message));
    const load = () =>
      merchantCall("webhooks/events")
        .then((r) => setEvents(r.events))
        .catch((e) => setError(e.message));
    void load();
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, []);
  return (
    <main className="merchant-shell">
      <Link href="/merchant">← Merchant dashboard</Link>
      <p className="merchant-notice">
        DEMO MODE: signed local webhooks. No external service is contacted.
      </p>
      <h1>Webhooks & delivery log</h1>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <section className="merchant-card">
        <h2>Built-in demo receiver</h2>
        <p>
          Events are signed with HMAC-SHA256 over the timestamp and exact JSON
          body. The receiver validates the signature and accepts an event ID
          only once. The private signing key stays on the server and survives
          restarts.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await merchantCall("webhooks", { enabled, receiver_mode: mode });
              setNotice(
                "Webhook settings saved. Create a payment or refund to queue new events.",
              );
              setError("");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <label>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Enable signed webhooks
          </label>
          <label>
            Receiver scenario
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="success">Accept every delivery</option>
              <option value="fail_twice">Fail twice, then accept</option>
              <option value="always_fail">
                Always fail (test retry exhaustion)
              </option>
            </select>
          </label>
          <button className="button primary">Save settings</button>
        </form>
        <p>
          Automatic retries use 2, 4, 8 and 16 second delays, up to five
          attempts per batch. Failed events can be retried manually after fixing
          the receiver scenario. Pending events are retained if the app stops.
          Disabled webhooks pause existing pending events and do not queue new
          ones.
        </p>
      </section>
      <section className="merchant-card">
        <h2>Latest 100 events</h2>
        {!events.length && (
          <p>
            No deliveries yet. Enable webhooks, then create and complete a demo
            payment.
          </p>
        )}
        {events.map((e) => (
          <article
            key={e.id}
            style={{ borderBottom: "1px solid #ddd", padding: 18 }}
          >
            <h3>
              {e.event_type} ·{" "}
              <span data-event-status={e.status}>{e.status}</span>
            </h3>
            <p>
              <code>{e.id}</code> · {e.attempts} attempts
            </p>
            <p>
              {e.payload.payment_id && (
                <Link href={`/merchant/payments/${e.payload.payment_id}`}>
                  Payment details
                </Link>
              )}{" "}
              · {e.payload.status}
            </p>
            {["FAILED", "RETRY"].includes(e.status) && (
              <button
                className="button secondary"
                onClick={async () => {
                  try {
                    await merchantCall(`webhooks/events/${e.id}/retry`, {});
                    setNotice("Retry queued.");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Retry event
              </button>
            )}
            <ul>
              {e.deliveries.map((d) => (
                <li key={d.attempt}>
                  Attempt {d.attempt} · HTTP {d.http_status ?? "no response"} ·{" "}
                  {d.result} ·{" "}
                  {d.signature_valid
                    ? "Signature verified"
                    : "No signature acknowledgement"}
                  <small>
                    {" "}
                    · {new Date(d.created_at).toLocaleTimeString()}
                  </small>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>
    </main>
  );
}
