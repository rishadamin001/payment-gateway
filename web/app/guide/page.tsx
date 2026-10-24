import Link from 'next/link';
import { Brand, Icon } from '../components/icons';

export default function Guide() {
  return <div className="info-page">
    <header className="info-header"><Link href="/" aria-label="PayBD Demo home"><Brand /></Link><Link href="/">Back to workspace <Icon name="arrow" size={16} /></Link></header>
    <main className="info-content"><span className="info-demo"><Icon name="shield" size={15} />DEMO MODE: no real money</span><p className="eyebrow" style={{ marginTop: 30 }}>M1 · PAYMENTS CORE</p><h1>Your first payment journey.</h1><p className="info-lead">Create a simulated request, receive a payment ID, and follow its history. PayBD is a university learning project inspired by payment gateways in Bangladesh.</p>
      <div className="guide-grid">
        <section className="guide-card"><h2>01. Create a request</h2><p>Use <strong>Create test payment</strong> in the workspace, or call the API from your server. Amounts are whole numbers in paisa: 150000 paisa means ৳1,500.00.</p><pre>{`POST /v1/payments
Authorization: Bearer <your test key>
Idempotency-Key: unique-order-1001
Content-Type: application/json

{
  "amount_paisa": 150000,
  "currency": "BDT",
  "merchant_order_id": "ORDER-1001",
  "success_url": "http://localhost:3001/",
  "cancel_url": "http://localhost:3001/"
}`}</pre><ul className="guide-list"><li>Keep test keys in your server’s environment variables.</li><li>Identical retries with the same idempotency key return the original request.</li><li>Reusing a key with different details returns HTTP 409.</li></ul></section>
        <section className="guide-card"><h2>02. Follow its history</h2><p>Select any payment in the workspace to see its details, or look it up with its ID. Only the authenticated merchant’s requests are accessible.</p><pre>{`GET /v1/payments/:id
Authorization: Bearer <your test key>

// Response includes:
{
  "status": "PENDING",
  "amount_paisa": 150000,
  "amount_display": "৳1,500.00",
  "test_mode": true,
  "history": [ /* recorded changes */ ]
}`}</pre><ul className="guide-list"><li><strong>HTTP 401:</strong> missing, invalid or revoked key.</li><li><strong>HTTP 403:</strong> merchant is not active.</li><li><strong>HTTP 404:</strong> payment does not belong to this merchant or does not exist.</li></ul></section>
        <section className="guide-card"><h2>Seven states. Clear rules.</h2><p>Payment states follow the project’s authoritative payment workflow. The database enforces every allowed change.</p><div className="workflow-list"><div><strong>Pending</strong>May become Paid, Failed, Cancelled or Expired.</div><div><strong>Paid</strong>May become Refunded or Partially refunded.</div><div><strong>Partially refunded</strong>May become Refunded.</div><div><strong>Failed · Cancelled · Expired · Refunded</strong>Final states. No further transitions.</div></div></section>
        <section className="guide-card"><h2>A sandbox, from the start.</h2><p>M1 includes payment creation, merchant authentication, duplicate protection, payment lookup and recorded state history. Seeded examples let you explore all seven states.</p><ul className="guide-list"><li>No real money, provider connections or bank transactions.</li><li>No cards, PINs, OTPs or payment credentials are collected.</li><li>The checkout link leads to an informational page. The checkout simulator is reserved for M2.</li><li>No refund execution, webhooks or payouts are included in M1.</li></ul><div className="notice-inline"><Icon name="shield" /><p>All merchants and transactions in the supplied demo dataset are fictional.</p></div><Link className="button primary full-width" href="/">Explore the workspace <Icon name="arrow" size={16} /></Link></section>
      </div>
    </main>
  </div>;
}
