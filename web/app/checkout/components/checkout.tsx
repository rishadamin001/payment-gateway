'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Brand, Icon, type IconName } from '../../components/icons';
import { stateLabels, type PaymentStatus } from '@/lib/payment-types';
import '../checkout.css';

type Method = 'card' | 'bkash' | 'nagad' | 'rocket' | 'bank';
type CheckoutPayment = {
  id: string; merchant_name: string; merchant_order_id: string;
  amount_paisa: number; amount_display: string; currency: string; status: PaymentStatus;
  expires_at: string; server_time: string; shop_order_id: string | null; payment_link_id?: string | null; method: Method | null;
};
type Challenge = { challenge_id: string; method: Method; fake_code: string; expires_at: string };
const methods: { id: Method; label: string; initials: string; subtitle: string; account: string; processing: string }[] = [
  { id: 'card', label: 'Demo card', initials: '▰', subtitle: 'A fictional card, ready to try', account: 'PayBD classroom card •••• 0000', processing: 'Verifying your classroom card' },
  { id: 'bkash', label: 'bKash', initials: 'b', subtitle: 'Practice a mobile wallet payment', account: 'Fictional bKash wallet · DEMO-BKASH', processing: 'Confirming your simulated bKash payment' },
  { id: 'nagad', label: 'Nagad', initials: 'N', subtitle: 'Practice a mobile wallet payment', account: 'Fictional Nagad wallet · DEMO-NAGAD', processing: 'Confirming your simulated Nagad payment' },
  { id: 'rocket', label: 'Rocket', initials: 'R', subtitle: 'Practice a mobile wallet payment', account: 'Fictional Rocket wallet · DEMO-ROCKET', processing: 'Confirming your simulated Rocket payment' },
  { id: 'bank', label: 'Demo bank', initials: '▥', subtitle: 'Try a fictional bank transfer', account: 'PayBD classroom bank · DEMO-BANK', processing: 'Recording your simulated bank transfer' },
];
const results: Record<PaymentStatus, {title: string; copy: string; icon: IconName}> = {
  PENDING: { title: 'Your payment is pending', copy: 'Your request is still waiting for confirmation.', icon: 'clock' },
  PAID: { title: 'Payment successful', copy: 'Your demo payment is confirmed. You can now return to your order.', icon: 'check' },
  FAILED: { title: 'Payment failed', copy: 'This simulated payment was declined. Return to your order and start a fresh attempt.', icon: 'close' },
  CANCELLED: { title: 'Payment cancelled', copy: 'You cancelled this attempt. Your order can be paid with a new checkout request.', icon: 'close' },
  EXPIRED: { title: 'Payment timed out', copy: 'The checkout time limit was exceeded, so this payment could not complete. Return to your cart to try again.', icon: 'clock' },
  REFUNDED: { title: 'Payment refunded', copy: 'This demo payment has been fully refunded in the merchant workspace.', icon: 'refresh' },
  PARTIALLY_REFUNDED: { title: 'Payment partially refunded', copy: 'A partial refund has been recorded for this demo payment.', icon: 'refresh' },
};
function secondsLeft(deadline: string, now: number) { return Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000)); }
function clock(seconds: number) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }

export default function Checkout({ id }: { id: string }) {
  const [payment, setPayment] = useState<CheckoutPayment | null>(null);
  const [method, setMethod] = useState<Method>('card');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState('');
  const [now, setNow] = useState(0);
  const offset = useRef(0);
  const active = useRef(false);
  const sequence = useRef(0);
  const mounted = useRef(false);
  const expiryRequested = useRef(false);
  const refresh = useCallback(async () => {
    if (active.current) return;
    const current = ++sequence.current;
    try {
      const response = await fetch(`/api/checkout/${encodeURIComponent(id)}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      if (!mounted.current || current !== sequence.current) return;
      offset.current = Date.parse(data.server_time) - Date.now();
      setNow(Date.now() + offset.current);
      setPayment(data);
    } catch (cause) { if (mounted.current && current === sequence.current) setError(cause instanceof Error ? cause.message : 'Unable to load this checkout.'); }
  }, [id]);
  useEffect(() => {
    mounted.current = true;
    const requests = sequence;
    expiryRequested.current = false;
    void refresh();
    const tick = setInterval(() => setNow(Date.now() + offset.current), 1000);
    const poll = setInterval(() => void refresh(), 3000);
    return () => { mounted.current = false; clearInterval(tick); clearInterval(poll); requests.current++; };
  }, [refresh]);
  const pending = payment?.status === 'PENDING';
  const remaining = payment && now ? secondsLeft(payment.expires_at, now) : 0;
  const challengeRemaining = challenge && now ? secondsLeft(challenge.expires_at, now) : 0;
  useEffect(() => {
    if (pending && now > 0 && remaining === 0 && !busy && !expiryRequested.current) {
      expiryRequested.current = true;
      // The server owns expiry and its EXPIRED history transition. Browser time
      // never chooses a payment outcome or forces an early expiration.
      void refresh();
    }
  }, [pending, now, remaining, busy, refresh]);

  async function action(name: string, body: object = {}) {
    if (active.current) return;
    active.current = true;
    ++sequence.current;
    setBusy(true); setError(''); setProcessing(name);
    try {
      // Keep a short visible handoff while the real demo API records its result.
      // The result screen is shown only after the response has been verified.
      const [response] = await Promise.all([
        fetch(`/api/checkout/${encodeURIComponent(id)}/${name}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
        }),
        new Promise<void>(resolve => setTimeout(resolve, 1000)),
      ]);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      if (!mounted.current) return;
      if (name === 'challenge') { setChallenge(data); setCode(''); }
      else { setPayment(data); setChallenge(null); }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Connection interrupted. Refresh the status before retrying.');
    } finally {
      active.current = false;
      if (mounted.current) { setBusy(false); setProcessing(''); void refresh(); }
    }
  }
  function confirm(event: FormEvent) {
    event.preventDefault();
    if (!challenge) return;
    void action('confirm', { challenge_id: challenge.challenge_id, code });
  }
  const selected = methods.find(item => item.id === (challenge?.method ?? method))!;
  const result = payment ? results[payment.status] : null;
  const returnPath = payment?.payment_link_id ? `/pay/${payment.payment_link_id}` : payment?.shop_order_id ? `/shop/result/${payment.shop_order_id}` : '/merchant';
  const processingTitle = processing === 'challenge' ? `Opening ${selected.label}` : processing === 'cancel' ? 'Cancelling this payment' : processing === 'expire' ? 'Closing this practice session' : selected.processing;

  return <div className="checkout-shell">
    <header className="checkout-top"><Link href="/shop" aria-label="PayBD Demo shop"><Brand /></Link><nav aria-label="Checkout navigation"><Link href="/shop">Demo shop</Link><Link href="/merchant" className="checkout-merchant-link">Merchant dashboard <Icon name="arrow" size={14} /></Link></nav></header>
    <div className="checkout-demo"><Icon name="shield" size={16} /><strong>DEMO MODE · FAKE MONEY ONLY</strong><span>No real cards, PINs, OTPs or payment providers.</span></div>
    <main className="checkout-layout">
      <aside className="checkout-summary"><div className="checkout-summary-top"><span className="checkout-secure-mark"><Icon name="shield" size={21} /></span><span>PAYBD HOSTED CHECKOUT<small>A classroom payment experience</small></span></div><p className="eyebrow">YOU ARE PAYING</p><h2>{payment?.merchant_name ?? 'PayBD Demo'}</h2><strong className="checkout-total">{payment?.amount_display ?? '—'}</strong><span className="checkout-currency">Bangladeshi taka · BDT</span><dl><div><dt>Order reference</dt><dd>{payment?.merchant_order_id ?? 'Loading…'}</dd></div><div><dt>Payment reference</dt><dd className="mono break-all">{id}</dd></div><div><dt>Status</dt><dd>{payment ? stateLabels[payment.status] : 'Connecting'}</dd></div></dl>{pending && <div className={`checkout-timer${remaining <= 30 ? ' timer-urgent' : ''}`} aria-label="Checkout time remaining"><Icon name="clock" size={19} /><div><span>{remaining ? 'Time left to complete' : 'Checking final status'}</span><strong>{remaining ? clock(remaining) : '0:00'}</strong></div></div>}<div className="checkout-trust"><Icon name="shield" size={20} /><p>Your result is verified by the demo server. No real money moves and no financial details are collected.</p></div><Link href="/shop" className="checkout-summary-back">← Back to the demo shop</Link></aside>
      <section className="checkout-main" aria-busy={busy}>
        {error && <div className="checkout-error" role="alert"><p>{error}</p><button className="text-button" disabled={busy} onClick={() => { setError(''); void refresh(); }}>Refresh status</button></div>}
        {!payment && !error && <div className="checkout-connecting" role="status"><span className="checkout-loader" /><p>Opening your payment request…</p></div>}
        {!payment && error && <Link className="button secondary" href="/shop">Back to demo shop</Link>}
        {payment && busy && <div className={`checkout-processing method-${selected.id}`} role="status" aria-live="polite" data-processing={selected.id}><div className="processing-orbit"><i /><span className="method-mark">{selected.initials}</span></div><p className="eyebrow">{selected.label.toUpperCase()} · DEMO MODE</p><h1>{processingTitle}</h1><p>Please keep this page open while PayBD checks and records your request.</p><ol className="processing-steps"><li><Icon name="check" size={16} />Request received</li><li><span className="checkout-loader" />{processing === 'challenge' ? 'Preparing fake verification' : 'Recording verified result'}</li><li><Icon name="clock" size={16} />Your result appears here</li></ol><strong className="processing-amount">{payment.amount_display}</strong><span className="processing-footnote">Simulation only. No provider is contacted.</span></div>}
        {payment && !busy && !pending && result && <div className={`checkout-result result-${payment.status.toLowerCase()}`} data-payment-result={payment.status} role="status" aria-live="polite"><span className="checkout-result-icon"><Icon name={result.icon} size={37} /></span><p className="eyebrow">{payment.status === 'PAID' ? 'CONFIRMED BY PAYBD DEMO' : 'PAYMENT ATTEMPT COMPLETE'}</p><h1>{result.title}</h1><p>{result.copy}</p><span className="checkout-result-label">{payment.status === 'EXPIRED' ? 'EXPIRED · TIME LIMIT EXCEEDED' : stateLabels[payment.status]}</span><div className="checkout-receipt"><span>Recorded amount</span><strong>{payment.amount_display}</strong>{payment.method && <small>{methods.find(item => item.id === payment.method)?.label ?? payment.method} · simulated payment</small>}<div><span>Payment reference</span><code>{id}</code></div></div><ol className="checkout-result-timeline" aria-label="Payment progress"><li><Icon name="check" size={15} />Request created</li><li><Icon name={result.icon} size={15} />{payment.status === 'PAID' ? 'Payment confirmed' : payment.status === 'EXPIRED' ? 'Time limit exceeded' : stateLabels[payment.status]}</li><li><Icon name="shield" size={15} />Result saved in payment history</li></ol><Link className="button primary full-width" href={returnPath}>{payment.payment_link_id ? 'Return to payment link' : payment.shop_order_id ? 'Return to shop receipt' : 'Return to merchant workspace'}<Icon name="arrow" size={17} /></Link><Link className="button secondary full-width" href="/shop">{payment.status === 'PAID' ? 'Explore the demo shop' : 'Back to shop & try again'}</Link><p className="checkout-result-disclaimer">No real money was charged.</p></div>}
        {payment && !busy && pending && <>
          <div className="checkout-progress" aria-label="Checkout progress"><span className={!challenge ? 'current' : 'done'}><i>{challenge ? '✓' : '1'}</i><b>Payment</b></span><em /><span className={challenge ? 'current' : ''}><i>2</i><b>Verify</b></span><em /><span><i>3</i><b>Complete</b></span></div>
          {!challenge ? <div className="checkout-step" key="method"><p className="eyebrow">ONE CHECKOUT. YOUR CHOICE.</p><h1>Choose how to pay.</h1><p className="checkout-intro">Try a familiar payment journey with a fictional account. All five methods run entirely inside this demo.</p><div className="checkout-methods" role="group" aria-label="Payment method">{methods.map(item => <button key={item.id} className={`checkout-method method-${item.id}${method === item.id ? ' selected' : ''}`} onClick={() => setMethod(item.id)} aria-pressed={method === item.id}><span className="method-mark">{item.initials}</span><span><strong>{item.label}</strong><small>{item.subtitle}</small></span><span className="method-radio" /></button>)}</div><div className={`fictional-account method-${method}`}><Icon name="shield" size={17} /><div><span>READY TO TRY · FICTIONAL ACCOUNT</span><strong>{selected.account}</strong></div></div><button className="button primary full-width checkout-continue" disabled={!remaining} onClick={() => void action('challenge', { method })}>Continue with {selected.label}<Icon name="arrow" size={17} /></button><p className="checkout-step-note">Next: enter the displayed fake OTP. No account details needed.</p></div> : <form onSubmit={confirm} className={`practice-form checkout-step method-${selected.id}`} key="verify"><p className="eyebrow">{selected.label.toUpperCase()} · PRACTICE VERIFICATION</p><h1>One small step to finish.</h1><p className="checkout-intro">Use the fake code below to confirm your demo payment. No SMS was sent. Never enter a real OTP or PIN.</p><div className="fake-code"><span>YOUR FAKE PRACTICE CODE</span><strong>{challenge.fake_code}</strong><small>{challengeRemaining ? `Code valid for ${clock(challengeRemaining)}` : 'This code expired. Open a new practice step below.'}</small></div><label>Practice OTP<input aria-label="Practice OTP" inputMode="numeric" autoComplete="off" pattern="[0-9]{6}" maxLength={6} minLength={6} required placeholder="Enter 000000" value={code} onChange={event => setCode(event.target.value)} /></label><button className="button primary full-width checkout-continue" disabled={!remaining || !challengeRemaining}>Confirm simulated payment<Icon name="arrow" size={17} /></button><button type="button" className="text-button" onClick={() => { setChallenge(null); setCode(''); setError(''); }}>Choose another method / new practice step</button></form>}
          <div className="checkout-bottom"><button className="text-button checkout-cancel" onClick={() => void action('cancel')}>Cancel payment</button><span><Icon name="shield" size={13} />DEMO MODE</span></div>
          <details className="checkout-test-tools"><summary>Classroom testing tools</summary><p>Optional instructor controls for demonstrating other results. Normal checkout confirms after the fake OTP.</p><div>{challenge && <button type="button" className="button secondary" disabled={!remaining || !challengeRemaining || code.length !== 6} onClick={() => void action('confirm', { challenge_id: challenge.challenge_id, code, outcome: 'failure' })}>Simulate declined payment</button>}<button type="button" className="button secondary" onClick={() => void action('expire')}>Simulate expiry</button></div></details>
        </>}
      </section>
    </main><footer className="checkout-footer"><span>PayBD Demo · MIS465 learning project</span><span>Fake money. Real learning.</span></footer>
  </div>;
}
