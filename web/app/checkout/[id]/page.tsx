import Link from 'next/link';
import { Suspense } from 'react';
import { Brand, Icon } from '../../components/icons';

async function PaymentReference({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const valid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id);
  return <dl className="detail-list"><div><dt>Payment reference</dt><dd className="mono break-all">{valid ? id : 'Invalid payment reference'}</dd></div><div><dt>Milestone</dt><dd>M1 · Payment requests</dd></div></dl>;
}

export default function CheckoutInformation({ params }: { params: Promise<{ id: string }> }) {
  return <div className="info-page"><header className="info-header"><Link href="/" aria-label="PayBD Demo home"><Brand /></Link><span className="mode-tag"><span />Test mode</span></header><main className="info-content"><section className="checkout-info"><span className="success-emblem"><Icon name="payments" size={27} /></span><p className="eyebrow">PAYBD DEMO · CHECKOUT INFORMATION</p><h1>A request, ready for its next step.</h1><p className="info-lead">This is the M1 checkout reference page. The hosted checkout simulator belongs to M2 and is not available yet.</p><Suspense fallback={<p className="loading-message">Loading payment reference…</p>}><PaymentReference params={params} /></Suspense><div className="notice-inline"><Icon name="shield" /><p><strong>DEMO MODE: no real money</strong><br />This page does not collect payment details or confirm a payment. View the request’s current status and history in the merchant workspace.</p></div><Link className="button primary full-width" href="/">Return to workspace <Icon name="arrow" size={17} /></Link><Link className="button secondary full-width" href="/guide">Read the M1 guide</Link></section></main></div>;
}
