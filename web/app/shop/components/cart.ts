export type Product = { id: string; name: string; description: string; price_paisa: number; category: string };
export type CartItem = { product_id: string; quantity: number };
export type OrderItem = CartItem & { name: string; unit_price_paisa: number; line_total_paisa: number };
export type ShopOrder = { id: string; payment_id: string; checkout_url: string; amount_paisa: number; amount_display: string; status: string; items: OrderItem[]; created_at?: string };
export const CART_KEY = 'paybd-demo-cart-v1';
export const ATTEMPT_KEY = 'paybd-demo-order-attempt-v1';
export type Attempt = { body: string; key: string; payment_id?: string; order_id?: string };
export function normalizeCart(value: unknown, products?: Product[]): CartItem[] {
  if (!Array.isArray(value)) return [];
  const items = new Map<string, number>();
  for (const candidate of value.slice(0, 20)) {
    if (!candidate || typeof candidate !== 'object') continue;
    const { product_id, quantity } = candidate;
    if (typeof product_id !== 'string' || product_id.length > 100 || !Number.isInteger(quantity) || quantity < 1 || quantity > 10) continue;
    if (products && !products.some(p => p.id === product_id)) continue;
    items.set(product_id, Math.min(10, (items.get(product_id) ?? 0) + quantity));
  }
  return [...items].sort(([a], [b]) => a.localeCompare(b)).map(([product_id, quantity]) => ({ product_id, quantity }));
}
export function cartBody(items: CartItem[]) { return JSON.stringify({ items: normalizeCart(items) }); }
export function loadCart(products?: Product[]) {
  try { return normalizeCart(JSON.parse(localStorage.getItem(CART_KEY) ?? '[]'), products); } catch { return []; }
}
export function loadAttempt(): Attempt | null {
  try {
    const value = JSON.parse(localStorage.getItem(ATTEMPT_KEY) ?? 'null');
    if (!value || typeof value.body !== 'string' || value.body.length > 8192 || typeof value.key !== 'string' || !/^shop-[a-f0-9-]{36}$/.test(value.key)) return null;
    if (value.payment_id !== undefined && (typeof value.payment_id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.payment_id))) return null;
    if (value.order_id !== undefined && (typeof value.order_id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.order_id))) return null;
    return value;
  } catch { return null; }
}
export function saveCart(items: CartItem[]) { try { localStorage.setItem(CART_KEY, JSON.stringify(items)); return true; } catch { return false; } }
export function saveAttempt(attempt: Attempt) { try { localStorage.setItem(ATTEMPT_KEY, JSON.stringify(attempt)); return true; } catch { return false; } }
export function clearAttempt() { try { localStorage.removeItem(ATTEMPT_KEY); } catch { /* Browser storage may be disabled. */ } }
