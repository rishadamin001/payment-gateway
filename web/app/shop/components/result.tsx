'use client';
import Link from 'next/link';
import Image from 'next/image';
import { productImage } from '@/lib/product-images';
import { useEffect, useState } from 'react';
import { Brand, Icon, type IconName } from '../../components/icons';
import { formatTaka } from '@/lib/payment-types';
import { cartBody, clearAttempt, loadAttempt, loadCart, saveCart, type ShopOrder } from './cart';
const results: Record<string, { heading: string; copy: string; icon: IconName; tone: string }> = {
  PENDING: { heading: 'Your order is waiting.', copy: 'The payment has not finished yet. Continue to the hosted demo checkout to complete your payment.', icon: 'clock', tone: 'waiting' },
  PAID: { heading: 'Demo payment successful.', copy: 'Your fictional order is paid. No real money moved and nothing will be shipped.', icon: 'check', tone: 'success' },
  FAILED: { heading: 'The demo payment failed.', copy: 'This simulated attempt was declined. Your cart is kept, so you can start a fresh checkout and try again.', icon: 'close', tone: 'failure' },
  CANCELLED: { heading: 'Payment cancelled.', copy: 'You cancelled this simulated payment. No money moved. Your cart is ready whenever you want to try again.', icon: 'close', tone: 'cancelled' },
  EXPIRED: { heading: 'Payment timed out.', copy: 'The payment could not finish before the timer ran out. Your cart is safe. Return to it to start a fresh demo checkout.', icon: 'clock', tone: 'expired' },
  REFUNDED: { heading: 'Demo payment refunded.', copy: 'This payment was fully refunded in the demo. No real funds were involved.', icon: 'refresh', tone: 'waiting' },
  PARTIALLY_REFUNDED: { heading: 'Partially refunded in demo.', copy: 'This payment is marked partially refunded in the demo. No real funds were involved.', icon: 'refresh', tone: 'waiting' },
};
export default function OrderResult({ id }: { id: string }) {
  const [order, setOrder] = useState<ShopOrder | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const response = await fetch(`/api/shop/orders/${encodeURIComponent(id)}`, { signal: controller.signal, cache: 'no-store' });
        const data: ShopOrder & { message?: string } = await response.json();
        if (!response.ok) throw new Error(data.message ?? 'This order could not be loaded.');
        if (!results[data.status] || !Array.isArray(data.items)) throw new Error('The order response could not be verified.');
        setOrder(data); setError('');
        const attempt = loadAttempt();
        if (attempt?.order_id === data.id) {
          if (data.status === 'PAID' && cartBody(loadCart()) === attempt.body && cartBody(data.items) === attempt.body) saveCart([]);
          if (data.status !== 'PENDING') clearAttempt();
        }
        if (data.status === 'PENDING') timer = setTimeout(() => void load(), 3000);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'The order service is unavailable. Try refreshing.');
      }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [id]);
  const result = order ? results[order.status] : null;
  return <div className="shop-shell"><header className="shop-header"><Link href="/shop" aria-label="PayBD Demo shop"><Brand /></Link><nav><Link href="/shop">Back to shop</Link><Link href="/merchant" className="shop-merchant-link"><Icon name="grid" size={16} />Merchant dashboard</Link></nav></header><div className="shop-demo"><Icon name="shield" size={16} /><strong>DEMO MODE: no real money.</strong><span>Fictional order. No delivery or real payment.</span></div>
  <main className="shop-receipt-wrap">{error && <div className="shop-receipt-error" role="alert"><h1>We couldn’t load this order.</h1><p>{error}</p><button className="button secondary" onClick={() => window.location.reload()}>Try again</button><Link className="button primary" href="/shop">Return to shop</Link></div>}
  {!order && !error && <p className="shop-loading" role="status">Checking your order’s current payment status…</p>}
  {order && result && <article className={`shop-receipt result-${result.tone}`} aria-labelledby="order-result-heading"><div className="shop-receipt-accent" aria-hidden="true" /><div className="shop-result-emblem"><Icon name={result.icon} size={32} /></div><p className="eyebrow">PAYBD DEMO · ORDER RESULT</p><h1 id="order-result-heading">{result.heading}</h1><p className="shop-result-copy">{result.copy}</p><span className="shop-result-status" data-status={order.status}>{order.status.replaceAll('_', ' ')}</span><div className="shop-receipt-id"><span>Order reference</span><strong>{order.id}</strong></div><h2>Your fictional order</h2><ul className="shop-receipt-lines">{order.items.map(item => <li key={item.product_id}><div className="shop-receipt-product">{productImage(item.product_id) && <Image src={productImage(item.product_id)!.src} alt={item.name} width={52} height={52} unoptimized />}<div><strong>{item.name}</strong><span>{item.quantity} × {formatTaka(item.unit_price_paisa)}</span></div></div><strong>{formatTaka(item.line_total_paisa)}</strong></li>)}</ul><div className="shop-receipt-total"><span>Total</span><strong>{formatTaka(order.amount_paisa)}</strong></div><div className="shop-receipt-actions">{order.status === 'PENDING' ? <Link className="button primary" href={`/checkout/${order.payment_id}`}>Continue checkout <Icon name="arrow" size={16} /></Link> : <Link className="button primary" href="/shop">{['FAILED', 'CANCELLED', 'EXPIRED'].includes(order.status) ? 'Return to cart & retry' : 'Continue shopping'}<Icon name="arrow" size={16} /></Link>}<Link className="button secondary" href="/merchant">Open merchant dashboard <Icon name="grid" size={16} /></Link></div><p className="shop-receipt-footnote"><Icon name="shield" size={14} />Status is checked with PayBD’s payment service.</p></article>}
  </main></div>;
}
