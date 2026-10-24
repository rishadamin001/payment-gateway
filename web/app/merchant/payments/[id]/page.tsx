import {Suspense} from 'react';
import Detail from './view';
async function Content({params}:{params:Promise<{id:string}>}){return <Detail id={(await params).id}/>;}
export default function Page({params}:{params:Promise<{id:string}>}){return <Suspense fallback={<p>Loading payment…</p>}><Content params={params}/></Suspense>;}
