'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Brand, Icon } from '../../components/icons';
import { stateLabels, type PaymentStatus } from '@/lib/payment-types';
import '../checkout.css';

type Method = 'card' | 'bkash' | 'nagad' | 'rocket' | 'bank';
type CheckoutPayment = {
  id: string; merchant_name: string; merchant_order_id: string;
  amount_paisa: number; amount_display: string; currency: string; status: PaymentStatus;
  expires_at: string; server_time: string; shop_order_id: string | null; payment_link_id?: string | null; method: Method | null;
};
type Challenge = { challenge_id: string; method: Method; fake_code: string; expires_at: string };
const methods: { id: Method; label: string; initials: string; subtitle: string; account: string }[] = [
  { id: 'card', label: 'Demo card', initials: '▰', subtitle: 'Fictional card account', account: 'PayBD classroom card •••• 0000' },
  { id: 'bkash', label: 'bKash', initials: 'b', subtitle: 'Simulated mobile wallet', account: 'Fictional bKash wallet · DEMO-BKASH' },
  { id: 'nagad', label: 'Nagad', initials: 'N', subtitle: 'Simulated mobile wallet', account: 'Fictional Nagad wallet · DEMO-NAGAD' },
  { id: 'rocket', label: 'Rocket', initials: 'R', subtitle: 'Simulated mobile wallet', account: 'Fictional Rocket wallet · DEMO-ROCKET' },
  { id: 'bank', label: 'Demo bank', initials: '▥', subtitle: 'Fictional bank transfer', account: 'PayBD classroom bank · DEMO-BANK' },
];
const titles: Record<PaymentStatus, string> = {
  PENDING: 'Your payment is pending', PAID: 'Payment successful', FAILED: 'Payment failed',
  CANCELLED: 'Payment cancelled', EXPIRED: 'Payment expired', REFUNDED: 'Payment refunded', PARTIALLY_REFUNDED: 'Payment partially refunded',
};
function secondsLeft(deadline: string, now: number) { return Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000)); }
function clock(seconds: number) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }

export default function Checkout({ id }: { id: string }) {
  const [payment, setPayment] = useState<CheckoutPayment | null>(null);
  const [method, setMethod] = useState<Method>('card');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [code, setCode] = useState('');
  const [outcome, setOutcome] = useState('success');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0);
  const offset = useRef(0);
  const active = useRef(false);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    if (active.current) return;
    const current = ++sequence.current;
    try {
      const response = await fetch(`/api/checkout/${encodeURIComponent(id)}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      if (current !== sequence.current) return;
      offset.current = Date.parse(data.server_time) - Date.now();
      setNow(Date.now() + offset.current);
      setPayment(data);
    } catch (cause) { if (current === sequence.current) setError(cause instanceof Error ? cause.message : 'Unable to load this checkout.'); }
  }, [id]);
  useEffect(() => {
    const requests = sequence;
    void refresh();
    const tick = setInterval(() => setNow(Date.now() + offset.current), 1000);
    const poll = setInterval(() => void refresh(), 3000);
    return () => { clearInterval(tick); clearInterval(poll); requests.current++; };
  }, [refresh]);

  async function action(name: string, body: object = {}) {
    if (active.current) return;
    active.current = true;
    ++sequence.current;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/checkout/${encodeURIComponent(id)}/${name}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      if (name === 'challenge') { setChallenge(data); setCode(''); }
      else { setPayment(data); setChallenge(null); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Connection interrupted. Retry safely or refresh the status.');
    } finally { active.current = false; setBusy(false); void refresh(); }
  }
  function confirm(event: FormEvent) {
    event.preventDefault();
    if (!challenge) return;
    void action('confirm', { challenge_id: challenge.challenge_id, code, outcome });
  }
  const selected = methods.find(item => item.id === method)!;
  const pending = payment?.status === 'PENDING';
  const remaining = payment && now ? secondsLeft(payment.expires_at, now) : 0;
  const challengeRemaining = challenge && now ? secondsLeft(challenge.expires_at, now) : 0;
  const returnPath = payment?.payment_link_id ? `/pay/${payment.payment_link_id}` : payment?.shop_order_id ? `/shop/result/${payment.shop_order_id}` : '/';

  return <div className="checkout-shell">
    <header className="checkout-top"><Link href="/shop" aria-label="PayBD Demo shop"><Brand /></Link><span className="mode-tag"><span />Test mode</span></header>
    <div className="checkout-demo"><Icon name="shield" size={16} /><strong>DEMO MODE: no real money</strong><span>No real cards, accounts, PINs or OTPs. No provider connection.</span></div>
    <main className="checkout-layout">
      <aside className="checkout-summary"><p className="eyebrow">PAYMENT REQUEST</p><h2>{payment?.merchant_name ?? 'PayBD Demo'}</h2><p className="checkout-summary-caption">A safe place to try the complete payment journey.</p><strong className="checkout-total">{payment?.amount_display ?? '—'}</strong><span className="checkout-currency">Bangladeshi taka · BDT</span><dl><div><dt>Order reference</dt><dd>{payment?.merchant_order_id ?? 'Loading…'}</dd></div><div><dt>Payment reference</dt><dd className="mono break-all">{id}</dd></div><div><dt>Status</dt><dd>{payment ? stateLabels[payment.status] : 'Connecting'}</dd></div></dl>{pending && <div className="checkout-timer"><Icon name="clock" size={18} /><span>{remaining ? `Complete within ${clock(remaining)}` : 'Checking expiry…'}</span></div>}<div className="checkout-trust"><Icon name="shield" size={22} /><p>Only fictional balances move here. Every outcome is recorded in your demo payment history.</p></div></aside>
      <section className="checkout-main">
        {error && <div className="checkout-error" role="alert"><p>{error}</p><button className="text-button" disabled={busy} onClick={() => { setError(''); void refresh(); }}>Refresh status</button></div>}
        {!payment && !error && <p role="status">Loading your payment request…</p>}
        {!payment && error && <Link className="button secondary" href="/shop">Back to demo shop</Link>}
        {payment && !pending && <div className={`checkout-result result-${payment.status.toLowerCase()}`}><span className="checkout-result-icon"><Icon name={payment.status === 'PAID' ? 'check' : payment.status === 'EXPIRED' ? 'clock' : 'close'} size={34} /></span><p className="eyebrow">SIMULATED RESULT</p><h1>{titles[payment.status]}</h1><p>{payment.status === 'PAID' ? 'Your demo payment was confirmed. No real money was charged.' : 'This request has finished. No real money was charged. A new request is needed to try again.'}</p><div className="checkout-receipt"><span>Recorded amount</span><strong>{payment.amount_display}</strong>{payment.method && <small>Method: {methods.find(item => item.id === payment.method)?.label ?? payment.method} · simulation only</small>}</div><Link className="button primary full-width" href={returnPath}>{payment.payment_link_id ? 'Return to payment link' : payment.shop_order_id ? 'Return to shop receipt' : 'Return to merchant workspace'}<Icon name="arrow" size={17} /></Link><Link className="button secondary full-width" href="/shop">Explore the demo shop</Link></div>}
        {payment && pending && <>
          <div className="checkout-progress"><span className={!challenge ? 'current' : 'done'}>1 <b>Choose method</b></span><i /><span className={challenge ? 'current' : ''}>2 <b>Practice OTP</b></span><i /><span>3 <b>Result</b></span></div>
          {!challenge ? <><p className="eyebrow">SIMULATED HOSTED CHECKOUT</p><h1>How would you like to try?</h1><p className="checkout-intro">Choose a demo payment method. These are educational simulations, not services offered by the named providers.</p><div className="checkout-methods" role="group" aria-label="Payment method">{methods.map(item => <button key={item.id} className={`checkout-method method-${item.id}${method === item.id ? ' selected' : ''}`} onClick={() => setMethod(item.id)} aria-pressed={method === item.id} disabled={busy}><span className="method-mark">{item.initials}</span><span><strong>{item.label}</strong><small>{item.subtitle}</small></span><span className="method-radio" /></button>)}</div><div className="fictional-account"><span>FICTIONAL ACCOUNT</span><strong>{selected.account}</strong><p>No account details are needed or collected.</p></div><button className="button primary full-width" disabled={busy || !remaining} onClick={() => void action('challenge', { method })}>{busy ? 'Opening practice step…' : `Continue with ${selected.label}`}<Icon name="arrow" size={17} /></button></> : <form onSubmit={confirm} className="practice-form"><p className="eyebrow">PRACTICE AUTHENTICATION · {selected.label.toUpperCase()}</p><h1>Try a fake OTP step.</h1><p className="checkout-intro">No message was sent. Use the classroom code shown below. Never enter a real OTP or PIN.</p><div className="fake-code"><span>FAKE PRACTICE CODE</span><strong>{challenge.fake_code}</strong><small>{challengeRemaining ? `Practice step expires in ${clock(challengeRemaining)}` : 'Practice step expired — start a new step below.'}</small></div><label>Practice OTP<input aria-label="Practice OTP" inputMode="numeric" autoComplete="off" pattern="[0-9]{6}" maxLength={6} minLength={6} required placeholder="Enter the fake code above" value={code} onChange={event => setCode(event.target.value)} /></label><label>Simulated outcome<select aria-label="Simulated outcome" value={outcome} onChange={event => setOutcome(event.target.value)}><option value="success">Success — mark demo payment paid</option><option value="failure">Failure — simulate a declined payment</option></select></label><button className="button primary full-width" disabled={busy || !remaining || !challengeRemaining}>{busy ? 'Confirming simulation…' : 'Confirm simulated payment'}<Icon name="arrow" size={17} /></button><button type="button" className="text-button" disabled={busy} onClick={() => { setChallenge(null); setCode(''); setError(''); }}>Choose another method / new practice step</button></form>}
          <div className="checkout-scenarios"><span>Explore other outcomes</span><div><button className="button secondary" disabled={busy} onClick={() => void action('cancel')}>Cancel payment</button><button className="button secondary" disabled={busy} onClick={() => void action('expire')}>Simulate expiry</button></div><p>Expiry is also enforced when the request’s actual time window ends.</p></div>
        </>}
      </section>
    </main><footer className="checkout-footer">PayBD Demo · MIS465 learning project · No funds transferred</footer>
  </div>;
}
