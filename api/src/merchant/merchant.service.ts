import { Injectable, BadRequestException, UnauthorizedException, ConflictException, NotFoundException, HttpException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { pool } from '../db.js';
import { checkPassword, hashPassword, credentials, digest, filters, csvCell } from './merchant-utils.js';
import { validateNewPayment, validateIdempotencyKey, fingerprintPayment } from '../payments/payment-utils.js';

@Injectable()
export class MerchantService {
 async identity(cookie?:string) {
  const token=cookie?.split(';').map(p=>p.trim()).find(p=>p.startsWith('paybd_session='))?.slice(14);
  if(!token||! /^[a-f0-9]{64}$/.test(token))throw new UnauthorizedException('Sign in to your merchant account');
  const r=await pool.query(`SELECT a.id AS account_id,m.id,m.business_name,m.email,m.status FROM merchant_sessions s JOIN merchant_accounts a ON a.id=s.account_id JOIN merchants m ON m.id=a.merchant_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()`,[digest(token)]);
  if(!r.rows[0])throw new UnauthorizedException('Session expired; sign in again');return r.rows[0] as {account_id:string;id:string;business_name:string;email:string;status:string};
 }
 async signup(body:Record<string,unknown>) {
  const c=credentials(body);
  if(typeof body.business_name!=='string'||!body.business_name.trim()||body.business_name.length>100)throw new BadRequestException('Business name is required');
  const hash=await hashPassword(c.password);const db=await pool.connect();let id:string;
  try{await db.query('BEGIN');const m=await db.query("INSERT INTO merchants(business_name,email,status) VALUES($1,$2,'ACTIVE') RETURNING id",[body.business_name.trim(),c.email]);const a=await db.query('INSERT INTO merchant_accounts(merchant_id,email,password_hash) VALUES($1,$2,$3) RETURNING id',[m.rows[0].id,c.email,hash]);id=a.rows[0].id;await db.query('COMMIT');}
  catch(e){await db.query('ROLLBACK');if((e as {code?:string}).code==='23505')throw new ConflictException('This email is already registered');throw e;}finally{db.release();}
  return this.session(id!);
 }
 async login(body:Record<string,unknown>) {
  const c=credentials(body);const key=digest(c.email);
  const count=await pool.query("SELECT count(*)::int n FROM merchant_login_attempts WHERE identity_hash=$1 AND created_at>now()-interval '15 minutes'",[key]);
  if(count.rows[0].n>=10)throw new HttpException('Too many sign-in attempts; try again in 15 minutes',429);
  await pool.query('INSERT INTO merchant_login_attempts(identity_hash) VALUES($1)',[key]);
  const account=(await pool.query('SELECT id,password_hash FROM merchant_accounts WHERE email=$1',[c.email])).rows[0];
  const match=await checkPassword(c.password,account?.password_hash??'00000000000000000000000000000000:'+ '00'.repeat(64));
  if(!account||!match)throw new UnauthorizedException('Email or password is incorrect');return this.session(account.id);
 }
 private async session(account:string){const token=randomBytes(32).toString('hex');await pool.query("INSERT INTO merchant_sessions(token_hash,account_id,expires_at) VALUES($1,$2,now()+interval '8 hours')",[digest(token),account]);return token;}
 async logout(cookie?:string){const token=cookie?.split(';').map(p=>p.trim()).find(p=>p.startsWith('paybd_session='))?.slice(14);if(token)await pool.query('UPDATE merchant_sessions SET revoked_at=now() WHERE token_hash=$1',[digest(token)]);return {ok:true};}
 async list(cookie:string,q:Record<string,string>,csv=false){const m=await this.identity(cookie);const f=filters(q,m.id);const page=Number(q.page??1);if(!Number.isSafeInteger(page)||page<1||page>100000)throw new BadRequestException('Invalid page');
 const count=await pool.query(`SELECT count(*)::int n FROM payments p WHERE ${f.where}`,f.values);
 if(csv&&count.rows[0].n>10000)throw new BadRequestException('Narrow the export to 10000 transactions or fewer');
 const result=await pool.query(`SELECT p.id,p.merchant_order_id,p.amount_paisa::float8 AS amount_paisa,p.currency,p.status,p.created_at FROM payments p WHERE ${f.where} ORDER BY p.created_at DESC,p.id LIMIT ${csv?10000:25} OFFSET ${csv?0:(page-1)*25}`,f.values);
 if(csv){const cols=['id','merchant_order_id','amount_paisa','currency','status','created_at'];return [cols.map(csvCell).join(','),...result.rows.map(r=>cols.map(k=>csvCell(r[k] instanceof Date?r[k].toISOString():r[k])).join(','))].join('\r\n');}
 const summary=(await pool.query(`SELECT count(*)::int total, count(*) FILTER(WHERE status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED'))::int successful, COALESCE(sum(amount_paisa) FILTER(WHERE status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED')),0)::float8 gross_paisa FROM payments p WHERE ${f.where}`,f.values)).rows[0];
 const chart=await pool.query(`SELECT (created_at AT TIME ZONE 'Asia/Dhaka')::date::text AS "day",count(*)::int total,count(*) FILTER(WHERE status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED'))::int successful,COALESCE(sum(amount_paisa) FILTER(WHERE status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED')),0)::float8 gross_paisa FROM payments p WHERE ${f.where} GROUP BY 1 ORDER BY 1 DESC LIMIT 60`,f.values);
 return {payments:result.rows,total:count.rows[0].n,page,summary,chart:chart.rows.reverse(),merchant:m,notice:'DEMO MODE: no real money'};
 }
 async detail(cookie:string,id:string){const m=await this.identity(cookie);if(!/^[a-f0-9-]{36}$/i.test(id))throw new BadRequestException('Invalid payment ID');const r=await pool.query(`SELECT p.id,p.merchant_order_id,p.amount_paisa::float8 amount_paisa,p.currency,p.status,p.created_at,p.expires_at,COALESCE((SELECT jsonb_agg(jsonb_build_object('from_status',h.from_status,'to_status',h.to_status,'changed_at',h.changed_at) ORDER BY h.id) FROM payment_status_history h WHERE h.payment_id=p.id),'[]') history FROM payments p WHERE p.id=$1 AND p.merchant_id=$2`,[id,m.id]);if(!r.rows[0])throw new NotFoundException('Payment not found');return r.rows[0];}
 async keys(cookie:string){const m=await this.identity(cookie);return {keys:(await pool.query('SELECT id,name,mode,key_prefix,created_at,revoked_at FROM merchant_api_keys WHERE merchant_id=$1 ORDER BY created_at DESC',[m.id])).rows,live_enabled:false};}
 async createKey(cookie:string){const m=await this.identity(cookie);const key=`paybd_test_${randomBytes(32).toString('base64url')}`;await pool.query("INSERT INTO merchant_api_keys(merchant_id,name,mode,key_prefix,key_hash) VALUES($1,'Merchant dashboard','TEST','paybd_test_',$2)",[m.id,digest(key)]);return {api_key:key,notice:'Copy this test key now. It is shown only once. Live mode is disabled.'};}
 async revokeKey(cookie:string,id:string){const m=await this.identity(cookie);if(!/^[a-f0-9-]{36}$/i.test(id))throw new BadRequestException('Invalid key ID');const r=await pool.query('UPDATE merchant_api_keys SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND merchant_id=$2 RETURNING id',[id,m.id]);if(!r.rows[0])throw new NotFoundException('Key not found');return {ok:true};}
 async demo(cookie:string,key:string,body:unknown){const m=await this.identity(cookie);const input=validateNewPayment(body);const idem=validateIdempotencyKey(key);const fp=fingerprintPayment(input);const r=await pool.query(`INSERT INTO payments(merchant_id,merchant_order_id,amount_paisa,currency,success_url,cancel_url,idempotency_key,request_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(merchant_id,idempotency_key) DO NOTHING RETURNING id`,[m.id,input.merchant_order_id,input.amount_paisa,input.currency,input.success_url,input.cancel_url,idem,fp]);if(r.rows[0])return r.rows[0];const prior=(await pool.query('SELECT id,request_fingerprint FROM payments WHERE merchant_id=$1 AND idempotency_key=$2',[m.id,idem])).rows[0];if(prior.request_fingerprint!==fp)throw new ConflictException('Idempotency key was used with other details');return {id:prior.id};}
}
