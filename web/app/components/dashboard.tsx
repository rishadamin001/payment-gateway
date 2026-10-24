'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { formatDate, formatTaka, formatTime, paymentStates, stateLabels, type Payment, type PaymentList, type PaymentStatus } from '@/lib/payment-types';
import { Brand, Icon, type IconName } from './icons';

function Status({ status }: { status: PaymentStatus }) {
  return <span className={`status status-${status.toLowerCase()}`}><span />{stateLabels[status]}</span>;
}

function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className={`modal${wide ? ' modal-wide' : ''}`} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal-inner">
      <header className="modal-header"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><Icon name="close" /></button></header>
      {children}
    </div>
  </dialog>;
}

function CreatePayment({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [order, setOrder] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Payment | null>(null);
  const attempt = useRef<{ body: string; key: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(amount)) { setError('Enter a positive taka amount with up to two decimal places.'); return; }
    const [whole, fractional = ''] = amount.split('.');
    const paisa = Number(whole) * 100 + Number(fractional.padEnd(2, '0'));
    if (paisa < 1 || paisa > 100_000_000_000) { setError('The amount must be between ৳0.01 and ৳1,00,00,00,000.00.'); return; }
    const body = JSON.stringify({ amount_paisa: paisa, currency: 'BDT', merchant_order_id: order.trim(), success_url: `${window.location.origin}/`, cancel_url: `${window.location.origin}/` });
    if (!attempt.current || attempt.current.body !== body) attempt.current = { body, key: `web-${crypto.randomUUID()}` };
    setBusy(true);
    try {
      const response = await fetch('/api/payments', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attempt.current.key }, body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? 'Unable to create the request. Please retry.');
      setResult(data);
      onCreated();
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to connect. Please retry; this request can be safely repeated.'); }
    finally { setBusy(false); }
  }

  return <Modal title={result ? 'Payment request created' : 'Create a test payment'} onClose={onClose}>
    {result ? <div className="created-result">
      <span className="success-emblem"><Icon name="check" size={28} /></span>
      <p className="eyebrow">TEST REQUEST</p><h3>{result.amount_display}</h3><Status status={result.status} />
      <p>Your request has been saved. No money has moved.</p>
      <dl className="detail-list"><div><dt>Order reference</dt><dd>{result.merchant_order_id}</dd></div><div><dt>Payment ID</dt><dd className="mono break-all">{result.id}</dd></div></dl>
      <Link className="button primary full-width" href={`/checkout/${result.id}`}>Open demo checkout <Icon name="arrow" size={17} /></Link>
      <button className="button secondary full-width" onClick={onClose}>Back to payments</button>
    </div> : <form onSubmit={submit} className="create-form">
      <p className="modal-intro">Try the first step of a payment journey. This creates a pending request for your demo merchant.</p>
      <label>Order reference<input required autoFocus maxLength={100} placeholder="e.g. INV-1001" value={order} onChange={(event) => setOrder(event.target.value)} autoComplete="off" /></label>
      <label>Amount in Bangladeshi taka<div className="amount-input"><span>৳</span><input required inputMode="decimal" placeholder="1,500.00" aria-label="Amount in Bangladeshi taka" value={amount} onChange={(event) => setAmount(event.target.value)} autoComplete="off" /><span>BDT</span></div><small>Enter digits only, with up to two decimal places.</small></label>
      <div className="notice-inline"><Icon name="shield" /><p><strong>DEMO MODE: no real money</strong><br />No card, bank, PIN or OTP details are needed.</p></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button primary full-width" disabled={busy || !order.trim()}>{busy ? 'Creating request…' : 'Create test payment'}<Icon name="arrow" size={17} /></button>
      <p className="form-footnote">Retries are protected against duplicate requests.</p>
    </form>}
  </Modal>;
}

function PaymentDetails({ id, onClose }: { id: string; onClose: () => void }) {
  const [payment, setPayment] = useState<Payment | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/payments/${encodeURIComponent(id)}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message);
        setPayment(data);
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Unable to load this payment.'); }
    }
    void load();
    return () => controller.abort();
  }, [id]);
  async function copy() {
    try { await navigator.clipboard.writeText(id); setCopied(true); }
    catch { setError('Clipboard access is unavailable. You can select the payment ID below.'); }
  }
  return <Modal title="Payment details" onClose={onClose} wide>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!payment && !error && <p className="loading-message" role="status">Loading payment history…</p>}
    {payment && <div className="payment-details">
      <div className="detail-amount"><div><p className="eyebrow">SIMULATED PAYMENT · BDT</p><h3>{payment.amount_display}</h3></div><Status status={payment.status} /></div>
      <dl className="detail-list">
        <div><dt>Order reference</dt><dd>{payment.merchant_order_id}</dd></div>
        <div><dt>Payment ID</dt><dd className="id-with-copy"><span className="mono break-all">{payment.id}</span><button className="icon-button" onClick={copy} aria-label={copied ? 'Payment ID copied' : 'Copy payment ID'}><Icon name={copied ? 'check' : 'copy'} size={16} /></button></dd></div>
        <div><dt>Created · Dhaka time</dt><dd>{formatDate(payment.created_at)} at {formatTime(payment.created_at)}</dd></div>
        <div><dt>Amount in paisa</dt><dd className="mono">{payment.amount_paisa.toLocaleString('en-BD')}</dd></div>
      </dl>
      <h3 className="section-title">Payment history</h3>
      <ol className="timeline">{payment.history?.map((entry) => <li key={entry.id}><span className="timeline-dot" /><div><strong>{stateLabels[entry.to_status]}</strong><p>{entry.from_status ? `${stateLabels[entry.from_status]} → ${stateLabels[entry.to_status]}` : 'Payment request created'}</p></div><time dateTime={entry.changed_at}>{formatDate(entry.changed_at)}<br />{formatTime(entry.changed_at)} · Dhaka</time></li>)}</ol>
      <div className="notice-inline"><Icon name="shield" /><p>Every state change is recorded. All activity is simulated.</p></div>
      <Link className="button secondary full-width" href={`/checkout/${payment.id}`}>Open demo checkout <Icon name="external" size={16} /></Link>
    </div>}
  </Modal>;
}

export default function Dashboard() {
  const [data, setData] = useState<PaymentList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PaymentStatus | 'ALL'>('ALL');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [lookup, setLookup] = useState('');
  const [page, setPage] = useState(1);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/payments', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      setData(result);
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to load payments. Please retry.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    async function initialLoad() {
      try {
        const response = await fetch('/api/payments', { cache: 'no-store', signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);
        setData(result);
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Unable to load payments. Please retry.');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void initialLoad();
    return () => controller.abort();
  }, []);

  const payments = data?.payments ?? [];
  const filtered = payments.filter((payment) => (status === 'ALL' || payment.status === status) && `${payment.id} ${payment.merchant_order_id}`.toLowerCase().includes(search.toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(filtered.length / 8));
  const activePage = Math.min(page, pageCount);
  const shown = filtered.slice((activePage - 1) * 8, activePage * 8);
  const total = payments.reduce((sum, payment) => sum + payment.amount_paisa, 0);
  const paid = payments.filter((payment) => payment.status === 'PAID');
  const pending = payments.filter((payment) => payment.status === 'PENDING');
  const statCards: { name: string; value: string; caption: string; icon: IconName; color: string }[] = [
    { name: 'Requested volume', value: formatTaka(total), caption: 'Across the latest payment requests', icon: 'bank', color: 'blue' },
    { name: 'Paid volume', value: formatTaka(paid.reduce((sum, payment) => sum + payment.amount_paisa, 0)), caption: `${paid.length} requests currently marked paid`, icon: 'check', color: 'green' },
    { name: 'Pending requests', value: String(pending.length).padStart(2, '0'), caption: 'Waiting for a simulated outcome', icon: 'clock', color: 'amber' },
    { name: 'Payment requests', value: String(payments.length).padStart(2, '0'), caption: 'Latest 100 · this demo merchant', icon: 'payments', color: 'purple' },
  ];
  function applyStatus(value: PaymentStatus | 'ALL') { setStatus(value); setPage(1); }

  return <div className="workspace">
    <aside className="sidebar">
      <Link href="/" className="brand-link" aria-label="PayBD Demo home"><Brand /></Link>
      <div className="workspace-label">MERCHANT WORKSPACE</div>
      <nav aria-label="Main navigation"><Link href="/merchant" className="nav-item">Merchant sign in</Link><Link href="/" className="nav-item active"><Icon name="grid" />Overview<span className="nav-active-dot" /></Link><a href="#payments" className="nav-item"><Icon name="payments" />Payments</a><Link href="/shop" className="nav-item"><Icon name="bank" />Demo shop</Link><Link href="/guide" className="nav-item"><Icon name="code" />API guide<Icon name="external" size={13} /></Link></nav>
      <div className="sidebar-bottom"><div className="sandbox-card"><span className="sandbox-orb"><Icon name="shield" size={22} /></span><strong>A safe place to explore.</strong><p>Test the journey.<br />Leave real money out of it.</p><Link href="/guide">Explore the demo <Icon name="arrow" size={16} /></Link></div><div className="course-label"><span className="course-icon">M1</span><div><strong>MIS465 project</strong><span>Payments core</span></div></div></div>
    </aside>
    <div className="workspace-main">
      <header className="topbar"><div className="topbar-breadcrumb">Workspace <span>/</span> <strong>Overview</strong></div><div className="topbar-right"><span className="mode-tag"><span />Test mode</span><span className="topbar-divider" /><span className="merchant-avatar">PD</span><span className="merchant-name">{data?.merchant.business_name ?? 'Demo merchant'}</span></div></header>
      <div className="demo-banner"><Icon name="shield" size={15} /><strong>DEMO MODE: no real money.</strong><span>Fictional merchants. Simulated payments. Built for learning.</span><span className="banner-tag">MIS465</span></div>
      <main className="main-content">
        <section className="page-heading"><div><p className="eyebrow">YOUR BUSINESS, AT A GLANCE</p><h1>Payment overview<span>.</span></h1><p>A clear view of every request, from start to finish.</p></div><div className="heading-actions"><button className="button secondary refresh-button" onClick={() => void refresh()} disabled={loading} aria-label="Refresh payments"><Icon name="refresh" size={17} className={loading ? 'spinning' : ''} /></button><button className="button primary" onClick={() => setCreating(true)} disabled={!data}><Icon name="plus" size={18} />Create test payment</button></div></section>
        <section className="hero-panel" aria-label="PayBD demo introduction"><div className="hero-copy"><span className="hero-kicker"><span />BUILT FOR BANGLADESH</span><h2>One connection.<br /><span>Every payment story.</span></h2><p>Experience a simpler payment journey with PayBD.<br className="desktop-break" /> Create, track and understand — all in a safe sandbox.</p><a href="#payments" className="hero-link">Explore your payments <Icon name="arrow" size={17} /></a></div><div className="hero-visual" aria-hidden="true"><div className="orbital orbit-one" /><div className="orbital orbit-two" /><div className="visual-dot dot-one" /><div className="visual-dot dot-two" /><div className="visual-card"><div className="visual-card-top"><span className="visual-logo">Pay<span>BD</span></span><span className="visual-demo">TEST</span></div><div className="visual-chip"><Icon name="shield" size={26} /></div><div className="visual-card-bottom"><div><span>ONE SAFE WORKSPACE</span><strong>Made for possibility.</strong></div><span className="taka-mark">৳</span></div></div><div className="floating-receipt"><span className="receipt-check"><Icon name="check" size={17} /></span><div><strong>Every step, recorded</strong><span>Clear payment history</span></div><span className="receipt-spark">✦</span></div></div></section>
        {error && <div className="error-banner" role="alert"><div><strong>Unable to refresh the workspace</strong><p>{error}{data ? ' Previously loaded data is still shown.' : ''}</p></div><button className="button secondary" onClick={() => void refresh()} disabled={loading}>Retry</button></div>}
        <section className="stats-grid" aria-label="Payment summary">{statCards.map((stat) => <article className="stat-card" key={stat.name}><div className="stat-top"><span>{stat.name}</span><span className={`stat-icon ${stat.color}`}><Icon name={stat.icon} size={17} /></span></div><strong className={data ? 'stat-value' : 'stat-value muted'}>{data ? stat.value : '—'}</strong><p>{stat.caption}</p></article>)}</section>
        <section className="activity-section"><div className="activity-title"><div><h2>Every state tells a story</h2><p>Payment lifecycle · current requests in your workspace</p></div><span className="subtle-label">7 PAYMENT STATES</span></div><div className="state-distribution" aria-label="Filter by payment state">{paymentStates.map((value) => { const count = payments.filter((payment) => payment.status === value).length; return <button key={value} className={`state-count state-color-${value.toLowerCase()}${status === value ? ' selected' : ''}`} onClick={() => { applyStatus(status === value ? 'ALL' : value); document.getElementById('payments')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} aria-pressed={status === value}><span className="state-count-label"><i />{stateLabels[value]}</span><strong>{data ? count : '—'}</strong><span className="state-track"><span style={{ width: payments.length ? `${Math.max(4, count / payments.length * 100)}%` : '0%' }} /></span></button>; })}</div></section>
        <section className="payments-section" id="payments"><div className="table-heading"><div><h2>Recent payments <span className="count-chip">{payments.length}</span></h2><p>All amounts in Bangladeshi taka. All activity is simulated.</p></div><span className="timezone-label"><Icon name="clock" size={14} />Dhaka time · UTC+6</span></div><div className="table-toolbar"><label className="search-box"><Icon name="search" size={18} /><input aria-label="Search payments" placeholder="Search order reference or payment ID…" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />{search && <button className="icon-button" aria-label="Clear search" onClick={() => { setSearch(''); setPage(1); }}><Icon name="close" size={14} /></button>}</label><label className="status-filter"><span>Status</span><select aria-label="Filter payment status" value={status} onChange={(event) => applyStatus(event.target.value as PaymentStatus | 'ALL')}><option value="ALL">All statuses</option>{paymentStates.map((value) => <option value={value} key={value}>{stateLabels[value]}</option>)}</select></label></div>
          <div className="table-scroll"><table><thead><tr><th>ORDER REFERENCE</th><th>AMOUNT</th><th>STATUS</th><th>CREATED</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{shown.map((payment) => <tr key={payment.id}><td><button className="order-button" onClick={() => setSelected(payment.id)}>{payment.merchant_order_id}</button><span className="payment-id">{payment.id.slice(0, 8)}…</span></td><td><strong className="table-amount">{payment.amount_display}</strong><span className="currency-label">BDT</span></td><td><Status status={payment.status} /></td><td><span className="table-date">{formatDate(payment.created_at)}</span><span className="table-time">{formatTime(payment.created_at)}</span></td><td><button className="icon-button table-detail" aria-label={`View payment ${payment.merchant_order_id}`} onClick={() => setSelected(payment.id)}><Icon name="chevron" size={17} /></button></td></tr>)}</tbody></table></div>
          {loading && !data && <div className="table-empty" role="status"><Icon name="refresh" size={28} className="spinning" /><strong>Connecting your workspace</strong><p>Loading your merchant’s payment requests…</p></div>}
          {!loading && shown.length === 0 && <div className="table-empty"><Icon name="payments" size={32} /><strong>{error ? 'Payments are unavailable' : search || status !== 'ALL' ? 'No matching payments' : 'Your first payment starts here'}</strong><p>{error ? 'Reconnect the payment service and try again.' : search || status !== 'ALL' ? 'Try another order reference or payment status.' : 'Create a test request to explore the payment journey.'}</p>{!error && (search || status !== 'ALL') && <button className="button secondary" onClick={() => { setSearch(''); applyStatus('ALL'); }}>Clear filters</button>}</div>}
          <div className="table-footer"><span>{filtered.length ? `${(activePage - 1) * 8 + 1}–${Math.min(activePage * 8, filtered.length)} of ${filtered.length} payments` : '0 payments'}<span className="table-footer-note"> · Latest 100 requests</span></span><div className="pagination"><button disabled={activePage <= 1} onClick={() => setPage(activePage - 1)} aria-label="Previous page"><Icon name="chevron" size={14} style={{ transform: 'rotate(180deg)' }} /></button><span>{activePage} / {pageCount}</span><button disabled={activePage >= pageCount} onClick={() => setPage(activePage + 1)} aria-label="Next page"><Icon name="chevron" size={14} /></button></div></div>
        </section>
        <section className="lookup-panel"><div className="lookup-caption"><span className="lookup-icon"><Icon name="search" size={21} /></span><div><h2>Have a payment ID?</h2><p>Find any request belonging to this demo merchant.</p></div></div><form onSubmit={(event) => { event.preventDefault(); if (lookup.trim()) setSelected(lookup.trim()); }}><input aria-label="Payment ID to look up" placeholder="Paste a payment ID" value={lookup} onChange={(event) => setLookup(event.target.value)} required /><button className="button secondary" type="submit">Look up<Icon name="arrow" size={16} /></button></form></section>
        <footer className="workspace-footer"><span><span className="footer-brand">PayBD Demo</span> · An MIS465 learning project</span><span><Icon name="shield" size={14} />Simulation only. Always.</span></footer>
      </main>
    </div>
    {creating && <CreatePayment onClose={() => setCreating(false)} onCreated={() => void refresh()} />}
    {selected && <PaymentDetails key={selected} id={selected} onClose={() => setSelected(null)} />}
  </div>;
}
