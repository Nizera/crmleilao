'use client';
import {useEffect,useState} from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {ArrowRight,Package} from 'lucide-react';
import {toast} from 'sonner';
import {fetchLandingCatalog} from '@/lib/landing-catalog-browser';
import type {RealtimeChannel} from '@supabase/supabase-js';
import {LANDING_LIVE_CHANNEL,newLandingLots,type LandingSnapshot} from '@/lib/landing-live';
import {landingStyles as s} from './landing-styles';
const initial:LandingSnapshot={lots:[],products:[],lotsAvailable:true,storeAvailable:true};
export function LandingLiveCatalog({section}:{section:'lots'|'store'}){
 const [data,setData]=useState(initial),[loading,setLoading]=useState(true),[failed,setFailed]=useState(false);
 useEffect(()=>{
  let active=true,busy=false,loaded=false;let previous=initial;const seen=new Set<string>();let since='';

  async function refresh(){
   if(!active||busy||document.visibilityState==='hidden')return;
   busy=true;
   try{
    const next=await fetchLandingCatalog();if(!active)return;
    if(next.lotsAvailable){
     if(loaded&&section==='lots'){
      const fresh=newLandingLots(previous.lots,next.lots,seen,since);
      fresh.forEach(l=>seen.add(l.id));
      if(fresh.length)toast.success(fresh.length===1?'Novo arremate cadastrado!':fresh.length+' novos arremates cadastrados!',{description:fresh[0].title,action:{label:'Ver arremates',onClick:()=>document.getElementById('arremates')?.scrollIntoView({behavior:'smooth'})},duration:7000});
     }
     if(!loaded){since=next.lots[0]?.created_at??new Date().toISOString();next.lots.forEach(l=>seen.add(l.id));loaded=true;}
    }
    previous={...next,lots:next.lotsAvailable?next.lots:previous.lots,products:next.storeAvailable?next.products:previous.products};
    setData(previous);setFailed(false);
   }catch{if(active)setFailed(true);}finally{busy=false;if(active)setLoading(false);}
  }
  void refresh();
  const interval=setInterval(()=>void refresh(),15000);
  document.addEventListener('visibilitychange',refresh);window.addEventListener('online',refresh);
  let channel:RealtimeChannel|null=null;let release:(()=>void)|null=null;
  // Realtime is secondary to the CTA: keep the SDK outside the initial landing bundle.
  if(section==='lots')void import('@/lib/supabase/client').then(({createClient})=>{
   if(!active)return;
   const db=createClient();channel=db.channel(LANDING_LIVE_CHANNEL).on('broadcast',{event:'catalog-changed'},()=>void refresh()).subscribe(status=>{if(status==='SUBSCRIBED')void refresh();});
   release=()=>{if(channel)void db.removeChannel(channel);};
  }).catch(()=>{/* Periodic refresh remains available. */});
  return()=>{active=false;clearInterval(interval);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('online',refresh);release?.();};
 },[section]);
 const available=section==='lots'?data.lotsAvailable:data.storeAvailable;
 const items=section==='lots'?data.lots.map(l=>({id:l.id,name:l.title,image:l.image,category:'Arrematado',detail:new Date(l.created_at).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'}),href:null})):data.products.map(p=>({...p,detail:p.price,href:'/loja?q='+encodeURIComponent(p.name)}));
 if(loading)return <p className={s.intro} role="status">Carregando {section==='lots'?'últimos arremates':'catálogo da loja'}…</p>;
 return <>
  {(failed||!available)&&<p className={s.intro} role="status">Não foi possível atualizar agora. Tentaremos novamente automaticamente.</p>}
  {!items.length&&!failed&&available&&<p className={s.intro}>{section==='lots'?'Veja os lotes das próximas rodadas no grupo do WhatsApp.':'A vitrine está sem itens disponíveis no momento.'}</p>}
  <div className={section==='lots'?s.carousel:'landing-storeGrid'} aria-label={section==='lots'?'Últimos arremates cadastrados':'Produtos reais da loja'}>{items.map(item=>{
   const content=<><div className={s.lotPicture}>{item.image?<Image src={item.image} alt={item.name} fill sizes="(max-width:767px) 82vw, 350px"/>:<Package aria-label="Lote sem foto" className="m-auto h-full w-12 text-neutral-400"/>}</div><p className={s.lotCategory}>{item.category}</p><h3>{item.name}</h3><span className={section==='lots'?s.sold:'landing-productPrice'}>{item.detail}</span>{item.href&&<span className="landing-productLink">Ver na loja <ArrowRight size={14}/></span>}</>;
   return item.href?<Link href={item.href} className="landing-liveProduct" key={item.id}>{content}</Link>:<article className={s.lotCard} key={item.id}>{content}</article>;
  })}</div>
  <p className={s.intro}>{section==='lots'?'Os lotes exibidos aqui já foram arrematados.':'Confira o preço e a disponibilidade na loja antes de comprar.'}</p>
 </>;
}
