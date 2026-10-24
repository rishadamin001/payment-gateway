import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { BadRequestException } from '@nestjs/common';
const derive = promisify(scrypt);
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export async function hashPassword(password: string) {
 const salt = randomBytes(16).toString('hex');
 const key = await derive(password, salt, 64) as Buffer;
 return `${salt}:${key.toString('hex')}`;
}
export async function checkPassword(password: string, stored: string) {
 const [salt, hash] = stored.split(':');
 const key = await derive(password, salt, 64) as Buffer;
 const expected = Buffer.from(hash ?? '', 'hex');
 return expected.length === key.length && timingSafeEqual(expected,key);
}
export function credentials(body: Record<string, unknown>) {
 if (!body || typeof body.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) || body.email.length>200 ||
 typeof body.password !== 'string' || body.password.length<12 || body.password.length>128) throw new BadRequestException('Use a valid email and a password of 12–128 characters');
 return {email:body.email.trim().toLowerCase(),password:body.password};
}
export function csvCell(value: unknown) {
 let text = String(value ?? '');
 if (/^[\s]*[=+@\-\t\r]/.test(text)) text = `'${text}`;
 return `"${text.replaceAll('"','""')}"`;
}
export function filters(q: Record<string,string>, merchant: string) {
 const values: unknown[]=[merchant]; const clauses=['p.merchant_id=$1'];
 const add=(clause:string,value:unknown)=>{values.push(value);clauses.push(clause.replace('?',`$${values.length}`));};
 if(q.search){ if(q.search.length>100)throw new BadRequestException('Search too long');add("(p.merchant_order_id ILIKE ? OR p.id::text ILIKE ?)",`%${q.search}%`);clauses[clauses.length-1]=clauses.at(-1)!.replace('?',`$${values.length}`); }
 if(q.status){if(!['PENDING','PAID','FAILED','CANCELLED','EXPIRED','REFUNDED','PARTIALLY_REFUNDED'].includes(q.status))throw new BadRequestException('Invalid status');add('p.status=?',q.status);}
 for(const name of ['from','to'])if(q[name]){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(q[name]) || Number.isNaN(Date.parse(q[name])) || new Date(q[name]).toISOString().slice(0,10)!==q[name])throw new BadRequestException('Invalid date');
  add(name==='from'?"p.created_at >= (?::date::timestamp AT TIME ZONE 'Asia/Dhaka')":"p.created_at < ((?::date + 1)::timestamp AT TIME ZONE 'Asia/Dhaka')",q[name]);
 }
 if(q.from&&q.to&&q.from>q.to)throw new BadRequestException('Start date must precede end date');
 return {where:clauses.join(' AND '),values};
}
