import {apiError} from '@/lib/gateway';
async function proxy(req:Request,{params}:{params:Promise<{path:string[]}>}){
 const {path}=await params;
 if(path.some(p=>! /^[a-zA-Z0-9_-]+$/.test(p)))return apiError('Invalid path',400);
 const origin=req.headers.get('origin');
 if(req.method!=='GET'){
  const allowed=process.env.PAYBD_WEB_ORIGIN?[process.env.PAYBD_WEB_ORIGIN]:['http://localhost:3001','http://127.0.0.1:3001'];
  if(!origin||!allowed.includes(origin)||new URL(origin).host!==req.headers.get('host')||req.headers.get('sec-fetch-site')==='cross-site')return apiError('Use the merchant site',403);
  if(!req.headers.get('content-type')?.startsWith('application/json'))return apiError('JSON required',415);
 }
 try{
  let body:string|undefined;
  if(req.method!=='GET'){
   const reader=req.body?.getReader();const chunks:Uint8Array[]=[];let size=0;
   if(reader)for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>8192){await reader.cancel();return apiError('Request too large',413);}chunks.push(r.value);}
   body=Buffer.concat(chunks).toString('utf8');JSON.parse(body);
  }
  const response=await fetch(new URL(`/v1/merchant/${path.join('/')}${new URL(req.url).search}`,process.env.PAYBD_API_BASE_URL??'http://127.0.0.1:3000'),{method:req.method,headers:{'Content-Type':'application/json',Cookie:req.headers.get('cookie')??'',Origin:origin??'','Idempotency-Key':req.headers.get('idempotency-key')??''},body,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
  const headers=new Headers({'Content-Type':response.headers.get('content-type')??'application/json','Cache-Control':'no-store'});
  for(const h of ['set-cookie','content-disposition'])if(response.headers.has(h))headers.set(h,response.headers.get(h)!);
  return new Response(await response.arrayBuffer(),{status:response.status,headers});
 }catch{return apiError('Merchant service unavailable or invalid JSON',503);}
}
export {proxy as GET,proxy as POST};
