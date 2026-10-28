import type { Metadata } from "next";
import Link from "next/link";
import "./architecture.css";

export const metadata: Metadata = {
  title: "Architecture | PayBD Demo",
  description:
    "How the PayBD classroom gateway, checkout, database, ledger and local webhooks work together.",
};

const layers = [
  {
    number: "01",
    name: "Browser & Next.js",
    port: "Local port 3001",
    detail:
      "Demo shop, hosted checkout, merchant workspace and administrator screens.",
    note: "Same-origin routes forward requests to the API.",
  },
  {
    number: "02",
    name: "NestJS API",
    port: "Local port 3000",
    detail:
      "Validates requests, checks sessions or test keys, and applies the payment rules.",
    note: "Only the server talks to the database.",
  },
  {
    number: "03",
    name: "PostgreSQL",
    port: "Local port 5432",
    detail:
      "Stores payments, history, invoices, refunds, ledger entries and delivery records.",
    note: "Transactions and constraints protect the saved records.",
  },
];

export default function Architecture() {
  return (
    <main className="arch-shell">
      <nav className="arch-nav" aria-label="PayBD sections">
        <Link className="arch-brand" href="/">
          PayBD Demo
        </Link>
        <Link href="/shop">Demo shop</Link>
        <Link href="/merchant">Merchant dashboard</Link>
        <Link href="/admin">Admin</Link>
        <Link href="/architecture" aria-current="page">
          Architecture
        </Link>
        <a href="/docs/">API docs</a>
      </nav>

      <header className="arch-hero">
        <p className="arch-kicker">MIS465 · HOW IT WORKS</p>
        <h1>One payment, a complete record.</h1>
        <p>
          PayBD demonstrates the journey from a shop cart to checkout, merchant
          reporting and a balanced ledger. The screens and records are real
          software; every payment is fictional.
        </p>
        <strong className="arch-demo">
          DEMO MODE: no real money, cards, PINs, OTPs or payment providers.
        </strong>
      </header>

      <section className="arch-section" aria-labelledby="arch-system-title">
        <div className="arch-section-heading">
          <span>THE SYSTEM</span>
          <h2 id="arch-system-title">Three parts running on your laptop</h2>
        </div>
        <ol
          className="arch-flow"
          aria-label="Requests flow from the browser through the API to PostgreSQL"
        >
          {layers.map((layer) => (
            <li key={layer.number} className="arch-layer">
              <span className="arch-step">{layer.number}</span>
              <h3>{layer.name}</h3>
              <p className="arch-port">{layer.port}</p>
              <p>{layer.detail}</p>
              <small>{layer.note}</small>
            </li>
          ))}
        </ol>
        <p className="arch-caption">
          The Windows launcher uses your existing PostgreSQL connection through{" "}
          <code>DATABASE_URL</code>. It starts the two applications locally and
          applies additive migrations without resetting your data.
        </p>
      </section>

      <section
        className="arch-section arch-two-columns"
        aria-label="Payment processing and delivery"
      >
        <article className="arch-card">
          <span className="arch-label">PAYMENT JOURNEY</span>
          <h2>Save the result together</h2>
          <ol className="arch-steps">
            <li>
              <strong>Create a request.</strong> The shop, payment link or
              invoice supplies an amount in integer paisa. The API creates a
              PENDING payment.
            </li>
            <li>
              <strong>Use the simulator.</strong> Choose card, bKash, Nagad,
              Rocket or bank, then the displayed practice OTP. No SMS or
              provider request is sent.
            </li>
            <li>
              <strong>Commit the outcome.</strong> A successful checkout updates
              the payment, appends its state history and posts its ledger
              entries in one database transaction.
            </li>
            <li>
              <strong>Show the saved state.</strong> The receipt and dashboard
              read the database result. Editing a browser URL cannot make a
              payment paid.
            </li>
          </ol>
        </article>
        <article className="arch-card arch-webhooks">
          <span className="arch-label">SIGNED LOCAL WEBHOOKS</span>
          <h2>Deliver, retry and explain</h2>
          <div
            className="arch-delivery"
            aria-label="Event queue to worker to local receiver"
          >
            <span>Database event queue</span>
            <span aria-hidden="true">↓</span>
            <span>Background worker</span>
            <span aria-hidden="true">↓</span>
            <span>Built-in local receiver</span>
          </div>
          <p>
            When webhooks are enabled, the event is saved with the payment or
            refund. The worker signs its timestamp and exact JSON body with
            HMAC-SHA256.
          </p>
          <p>
            The local receiver checks the signature and timestamp, and
            deduplicates event IDs. Failed attempts retry with delays; the
            delivery log preserves the outcome. Pending events survive an app
            restart.
          </p>
          <small>
            Only the built-in receiver is used. No real provider or external
            webhook destination is contacted.
          </small>
        </article>
      </section>

      <section className="arch-section" aria-labelledby="arch-states-title">
        <div className="arch-section-heading">
          <span>STATE RULES</span>
          <h2 id="arch-states-title">Seven states, only allowed transitions</h2>
        </div>
        <div className="arch-state-grid">
          <article>
            <h3>PENDING</h3>
            <p>
              May become <strong>PAID</strong>, <strong>FAILED</strong>,{" "}
              <strong>CANCELLED</strong> or <strong>EXPIRED</strong>.
            </p>
          </article>
          <article>
            <h3>PAID</h3>
            <p>
              May become <strong>PARTIALLY_REFUNDED</strong> or{" "}
              <strong>REFUNDED</strong>.
            </p>
          </article>
          <article>
            <h3>PARTIALLY_REFUNDED</h3>
            <p>
              May become <strong>REFUNDED</strong>. Further partial refunds are
              recorded individually while the payment remains partially
              refunded.
            </p>
          </article>
        </div>
        <p className="arch-caption">
          FAILED, CANCELLED, EXPIRED and REFUNDED are final. The database
          enforces these rules, including changes made outside the API.
        </p>
      </section>

      <section
        className="arch-section arch-two-columns"
        aria-label="Money and access controls"
      >
        <article className="arch-card">
          <span className="arch-label">ACCOUNTING</span>
          <h2>Every monetary posting balances</h2>
          <p>
            A successful payment debits clearing and credits merchant payable.
            Refunds reverse that movement. Settlements reserve available
            balances, and simulated payouts move them out of clearing.
          </p>
          <div className="arch-example">
            <strong>৳1,500.00 = 150,000 paisa</strong>
            <span>Debit: clearing · 150,000</span>
            <span>Credit: merchant payable · 150,000</span>
          </div>
          <p>
            Every journal must have matching debits and credits. Reconciliation
            compares payments, refunds, payouts and ledger totals. Unknown
            historical refund amounts are flagged for review, never guessed.
          </p>
          <small>
            Pending and unsuccessful requests have no monetary posting. All
            settlements and payouts are fictional.
          </small>
        </article>
        <article className="arch-card">
          <span className="arch-label">ACCESS & RELIABILITY</span>
          <h2>Different roles, protected records</h2>
          <ul className="arch-facts">
            <li>
              <strong>Repeat safely:</strong> idempotency keys and database
              locks prevent duplicate payments and withdrawals during retries.
            </li>
            <li>
              <strong>Separate identities:</strong> merchant and admin logins
              use distinct sessions. Passwords are hashed; cookies are HttpOnly.
            </li>
            <li>
              <strong>Keep secrets private:</strong> test keys are shown once;
              only hashes are stored. Webhook signing keys stay on the server
              and never appear in delivery logs.
            </li>
            <li>
              <strong>Explain changes:</strong> payment/refund histories and the
              audit log preserve important actions. Merchant suspension blocks
              new collections.
            </li>
          </ul>
        </article>
      </section>

      <footer className="arch-footer">
        <div>
          <h2>Explore the complete journey</h2>
          <p>
            Use fictional examples in your merchant dashboard, or start a fresh
            checkout in the shop.
          </p>
        </div>
        <div className="arch-actions">
          <Link href="/merchant">Open merchant dashboard</Link>
          <a href="/docs/">Browse OpenAPI / Swagger</a>
        </div>
      </footer>
    </main>
  );
}
