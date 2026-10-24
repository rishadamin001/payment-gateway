import {randomBytes,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
let cookie='';const base='http://127.0.0.1:3000/v1/merchant/';
async function call(path,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:'http://localhost:3001','Content-Type':'application/json','Idempotency-Key':randomUUID()},body:body?JSON.stringify(body):undefined});if(r.headers.has('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];assert.ok(r.ok);return r.headers.get('content-type')?.includes('csv')?r.text():r.json();}
try{
 await call('signup',{business_name:'M4 smoke fictional merchant',email:`smoke-${randomUUID()}@example.test`,password:randomBytes(24).toString('hex')});
 const m=await call('me');assert.ok(m.id);
 const p=await call('demo-payment',{amount_paisa:150000,currency:'BDT',merchant_order_id:'M4-SMOKE',success_url:'http://localhost:3001/merchant',cancel_url:'http://localhost:3001/merchant'});
 assert.equal((await call(`payments/${p.id}`)).history.length,1);
 assert.equal((await call('payments?search=M4-SMOKE')).total,1);
 assert.match(await call('payments/export'),/M4-SMOKE/);
 assert.equal((await call('keys')).live_enabled,false);
 await call('logout',{});console.log('PASS M4 live signup/session, scoped payment, filters, CSV, history, key metadata and logout.');
}catch{console.error('M4 smoke failed; no credentials displayed');process.exitCode=1;}
