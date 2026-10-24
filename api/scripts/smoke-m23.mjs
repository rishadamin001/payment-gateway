import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = process.env.PAYBD_API_URL ?? 'http://127.0.0.1:3000';
if (!['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname)) throw new Error('Smoke requires a local API');
const key = process.env.PAYBD_DEMO_API_KEY;
if (!key) throw new Error('Demo key must be provided via environment');
let phase = 'catalog';
async function call(path, body, merchant = false) {
 const response = await fetch(new URL(path, base), { method: body ? 'POST' : 'GET',
 headers: { 'Content-Type':'application/json', ...(merchant ? {Authorization:`Bearer ${key}`,'Idempotency-Key':randomUUID()} : {}) },
 body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
 assert.ok(response.ok); return response.json();
}
try {
 const catalog = await call('/v1/shop/catalog');
 for (const method of ['card','bkash','nagad','rocket','bank']) {
  phase = method;
  const order = await call('/v1/shop/orders',{items:[{product_id:catalog.products[0].id,quantity:2}]},true);
  assert.equal(order.amount_paisa,catalog.products[0].price_paisa*2);
  const challenge = await call(`/v1/checkout/${order.id}/challenge`,{method});
  const outcome = method==='bank'?'failure':'success';
  const result = await call(`/v1/checkout/${order.id}/confirm`,{challenge_id:challenge.challenge_id,code:'000000',outcome});
  assert.equal(result.status,outcome==='success'?'PAID':'FAILED');
  const receipt=await call(`/v1/shop/orders/${order.id}`,undefined,true);
  assert.equal(receipt.status,result.status);
 }
 for (const action of ['cancel','expire']) {
  phase = action;
  const order=await call('/v1/shop/orders',{items:[{product_id:catalog.products[0].id,quantity:1}]},true);
  const result=await call(`/v1/checkout/${order.id}/${action}`,{});
  assert.equal(result.status,action==='cancel'?'CANCELLED':'EXPIRED');
 }
 console.log('PASS: M2/M3 live shop totals, five methods, fake OTP, success/failure/cancel/expiry and database receipts.');
} catch { console.error(`M2/M3 smoke failed during ${phase}; no credentials displayed.`);process.exitCode=1; }
