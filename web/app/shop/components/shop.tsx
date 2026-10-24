'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Brand, Icon } from '../../components/icons';
import { formatTaka } from '@/lib/payment-types';
import { cartBody, clearAttempt, loadAttempt, loadCart, normalizeCart, saveAttempt, saveCart, type Attempt, type CartItem, type Product, type ShopOrder } from './cart';

const drawings = ['✦', '◉', '▤', '◈', '✺', '⌁'];
export default function Shop() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [storageNotice, setStorageNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState('All');
  const attempt = useRef<Attempt | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch('/api/shop/catalog', { signal: controller.signal, cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message ?? 'The demo catalogue could not be loaded.');
        const available: Product[] = data.products;
        setProducts(available);
        setCart(loadCart(available));
        attempt.current = loadAttempt();
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'The shop is unavailable. Try refreshing.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, []);
  function update(items: CartItem[]) {
    const safe = normalizeCart(items, products);
    setCart(safe);
    if (!saveCart(safe)) setStorageNotice('Browser storage is unavailable. Keep this tab open to retain your cart.');
    setError('');
  }
  function add(product: Product) {
    const found = cart.find(item => item.product_id === product.id);
    if (found) update(cart.map(item => item.product_id === product.id ? { ...item, quantity: Math.min(10, item.quantity + 1) } : item));
    else update([...cart, { product_id: product.id, quantity: 1 }]);
  }
  const total = cart.reduce((sum, item) => sum + (products.find(p => p.id === item.product_id)?.price_paisa ?? 0) * item.quantity, 0);
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  async function pay() {
    if (busy || !cart.length) return;
    setBusy(true); setError('');
    try {
      const body = cartBody(cart);
      let current = attempt.current;
      if (current?.body === body && current.order_id) {
        const existingResponse = await fetch(`/api/shop/orders/${current.order_id}`, { cache: 'no-store' });
        if (!existingResponse.ok) throw new Error('Unable to check your previous request. Retry safely when the connection returns.');
        const existing: ShopOrder = await existingResponse.json();
        if (existing.status === 'PENDING') { router.push(`/checkout/${existing.payment_id}`); return; }
        if (existing.status === 'PAID' || existing.status === 'REFUNDED' || existing.status === 'PARTIALLY_REFUNDED') {
          router.push(`/shop/result/${existing.id}`); return;
        }
        current = null; attempt.current = null; clearAttempt();
      }
      if (!current || current.body !== body) current = { body, key: `shop-${crypto.randomUUID()}` };
      attempt.current = current;
      if (!saveAttempt(current)) setStorageNotice('Browser storage is unavailable. Keep this tab open for safe retries.');
      const response = await fetch('/api/shop/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': current.key }, body });
      const order: ShopOrder & { message?: string } = await response.json();
      if (!response.ok) throw new Error(order.message ?? 'Unable to create an order. Please retry.');
      current = { ...current, order_id: order.id, payment_id: order.payment_id };
      attempt.current = current; saveAttempt(current);
      router.push(`/checkout/${order.payment_id}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The request could not complete. Retry safely.'); }
    finally { setBusy(false); }
  }
  const categories = ['All', ...new Set(products.map(product => product.category))];
  return <div className="shop-shell"><header className="shop-header"><Link href="/shop" aria-label="PayBD Demo shop"><Brand /></Link><nav><Link href="/">Merchant workspace</Link><a href="#cart" className="shop-cart-link">Your cart <span>{count}</span></a></nav></header>
    <div className="shop-demo"><Icon name="shield" size={16} /><strong>DEMO MODE: no real money.</strong><span>Fictional products. Nothing is charged or delivered.</span></div>
    <main className="shop-main"><section className="shop-hero"><div><p className="eyebrow">THE PAYBD DEMO STORE</p><h1>Small finds.<br /><span>A complete payment journey.</span></h1><p>Pick something you like, build a cart, and try a simulated checkout. A little shopping, a lot of learning.</p><a href="#catalogue" className="button primary">Explore the collection <Icon name="arrow" size={16} /></a></div><div className="shop-hero-art" aria-hidden="true"><div className="shop-bag">P<span>BD</span><i /></div><span className="shop-art-tag"><Icon name="check" size={17} />100% simulated</span></div></section>
    <div className="shop-layout"><section id="catalogue" className="shop-catalogue"><div className="shop-section-heading"><div><p className="eyebrow">CURATED FOR THE CLASSROOM</p><h2>The collection</h2></div><span>{products.length} fictional finds</span></div><div className="shop-categories" aria-label="Product categories">{categories.map(value => <button key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>{value}</button>)}</div>
    {loading ? <p role="status" className="shop-loading">Loading the demo collection…</p> : <div className="shop-product-grid">{products.filter(p => category === 'All' || p.category === category).map((product, i) => <article className="shop-product" key={product.id}><div className={`shop-product-art art-${i % 6}`} aria-hidden="true"><span>{drawings[i % drawings.length]}</span><small>PAYBD ORIGINALS</small></div><div className="shop-product-copy"><p className="eyebrow">{product.category}</p><h3>{product.name}</h3><p>{product.description}</p><div><strong>{formatTaka(product.price_paisa)}</strong><button className="button secondary" onClick={() => add(product)} disabled={busy || (cart.find(item => item.product_id === product.id)?.quantity ?? 0) >= 10} aria-label={`Add ${product.name} to cart`}><Icon name="plus" size={15} />Add</button></div></div></article>)}</div>}</section>
    <aside className="shop-cart" id="cart"><div className="shop-section-heading"><h2>Your cart</h2><span>{count} {count === 1 ? 'item' : 'items'}</span></div>{!cart.length ? <div className="shop-empty"><Icon name="payments" size={34} /><strong>A little empty, for now.</strong><p>Add a fictional product to start your demo journey.</p></div> : <><ul className="shop-cart-items">{cart.map(item => { const product = products.find(p => p.id === item.product_id); if (!product) return null; return <li key={item.product_id}><div className="shop-cart-item-title"><strong>{product.name}</strong><button aria-label={`Remove ${product.name}`} disabled={busy} onClick={() => update(cart.filter(p => p.product_id !== item.product_id))}><Icon name="close" size={15} /></button></div><div className="shop-cart-item-bottom"><label>Qty<select aria-label={`Quantity for ${product.name}`} value={item.quantity} disabled={busy} onChange={event => update(cart.map(p => p.product_id === item.product_id ? { ...p, quantity: Number(event.target.value) } : p))}>{Array.from({ length: 10 }, (_, index) => <option key={index + 1}>{index + 1}</option>)}</select></label><strong>{formatTaka(product.price_paisa * item.quantity)}</strong></div></li>; })}</ul><dl className="shop-totals"><div><dt>Subtotal</dt><dd>{formatTaka(total)}</dd></div><div><dt>Delivery</dt><dd>No delivery · demo</dd></div><div className="shop-total"><dt>Total</dt><dd>{formatTaka(total)}</dd></div></dl><button className="button primary shop-pay" disabled={busy} onClick={() => void pay()}>{busy ? 'Preparing checkout…' : `Pay ${formatTaka(total)}`}<Icon name="arrow" size={17} /></button></>}
    {error && <p className="form-error" role="alert">{error}</p>}{storageNotice && <p className="shop-storage-note" role="status">{storageNotice}</p>}<div className="shop-safe"><Icon name="shield" size={18} /><p><strong>Only pretend payments here.</strong><br />Try Card, bKash, Nagad, Rocket or Bank. Never enter real financial details.</p></div><p className="shop-price-note">Final totals are checked by the payment service. All prices are in Bangladeshi taka.</p></aside></div>
    <footer className="shop-footer"><span>PayBD Demo · MIS465 learning project</span><Link href="/guide">How the demo works <Icon name="arrow" size={13} /></Link></footer></main></div>;
}
