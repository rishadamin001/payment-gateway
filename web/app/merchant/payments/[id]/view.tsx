'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {merchantCall} from '../../page';
import '../../merchant.css';
type Payment={id:string;status:string;merchant_order_id:string;amount_paisa:number;history:{from_status:string|null;to_status:string;changed_at:string}[]};
export default function Detail({id}:{id:string}){const [p,setP]=useState<Payment|null>(null),[error,setError]=useState('');useEffect(()=>{merchantCall(`payments/${id}`).then(setP).catch(e=>setError(e.message));},[id]);return <main className="merchant-shell"><Link href="/merchant">← Merchant dashboard</Link><p className="merchant-notice">DEMO MODE: no real money.</p>{error&&<p role="alert">{error}</p>}{p&&<section className="merchant-card"><h1>{p.merchant_order_id}</h1><p><code>{p.id}</code></p><h2>৳{(p.amount_paisa/100).toFixed(2)} · {p.status}</h2>{p.status==='PENDING'&&<Link className="button primary" href={`/checkout/${id}`}>Open hosted checkout</Link>}<h2>State timeline</h2><ol className="merchant-timeline">{p.history.map((h,i)=><li key={i}><strong>{h.from_status??'Created'} → {h.to_status}</strong><p>{new Date(h.changed_at).toLocaleString('en-GB',{timeZone:'Asia/Dhaka'})} · Dhaka</p></li>)}</ol></section>}</main>;}
