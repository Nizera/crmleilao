'use client';
import dynamic from 'next/dynamic';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import type {RevenuePoint} from './revenue-chart';
import type {PipelineSlice} from './pipeline-chart';
const Revenue=dynamic(()=>import('./revenue-chart').then(m=>m.RevenueChart),{ssr:false,loading:()=> <Placeholder height={240}/>});
const Pipeline=dynamic(()=>import('./pipeline-chart').then(m=>m.PipelineChart),{ssr:false,loading:()=> <Placeholder height={200}/>});
function Placeholder({height}:{height:number}){return <div style={{height}} className="grid place-items-center rounded-lg bg-muted/40 text-xs text-muted-foreground" role="status">Carregando gráfico…</div>;}
function ChartGate({height,children}:{height:number;children:ReactNode}){
 const ref=useRef<HTMLDivElement>(null),[ready,setReady]=useState(false);
 useEffect(()=>{
  if(!('IntersectionObserver' in window)){const timer=setTimeout(()=>setReady(true),0);return()=>clearTimeout(timer);}
  const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setReady(true);observer.disconnect();}},{rootMargin:'250px'});
  if(ref.current)observer.observe(ref.current);return()=>observer.disconnect();
 },[]);
 return <div ref={ref} style={{minHeight:height}}>{ready?children:<Placeholder height={height}/>}</div>;
}
export function RevenueChart({data}:{data:RevenuePoint[]}){return <ChartGate height={240}><Revenue data={data}/></ChartGate>;}
export function PipelineChart({data}:{data:PipelineSlice[]}){return <ChartGate height={200}><Pipeline data={data}/></ChartGate>;}
