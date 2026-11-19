'use client';
import {useEffect,useState,useSyncExternalStore} from 'react';
import {usePathname} from 'next/navigation';
import {isStoreMarketingPath} from '@/lib/meta-commerce';
import {LANDING_GROUP_URL} from '@/lib/landing-content';
import {enableStorePixel,leaveStoreMarketing,readMarketingChoice,subscribeMarketingChoice,syncMarketingChoice,trackStoreEvent,trackLandingLead,writeMarketingChoice} from '@/lib/meta-browser';

export function StoreMarketing({pixelId}:{pixelId:string|null}) {
 const path=usePathname();const choice=useSyncExternalStore(subscribeMarketingChoice,readMarketingChoice,()=>undefined);
 const [editing,setEditing]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  if(path!=='/'&&!isStoreMarketingPath(path)){leaveStoreMarketing();return;}
  if(!pixelId||choice!==true){window.fbq?.('consent','revoke');return;}
  enableStorePixel(pixelId,path==='/');trackStoreEvent('PageView',{},undefined,path==='/');
  void syncMarketingChoice(true).catch(()=>{});
  return()=>{window.fbq?.('consent','revoke');};
 },[path,pixelId,choice]);
 useEffect(()=>{
  if(path!=='/'||!pixelId||choice!==true)return;
  const click=(event:MouseEvent)=>{
   if(event.defaultPrevented||event.button!==0||!(event.target instanceof Element))return;
   const link=event.target.closest<HTMLAnchorElement>('a[href]');
   if(!link)return;
   try{const url=new URL(link.href);if(url.origin===new URL(LANDING_GROUP_URL).origin&&url.pathname===new URL(LANDING_GROUP_URL).pathname)trackLandingLead(link.dataset.primaryGroupCta??(link.closest('header')?'header':link.closest('aside')?'sticky':'content'));}catch{/* Navigation is independent of tracking. */}
  };
  document.addEventListener('click',click);
  return()=>document.removeEventListener('click',click);
 },[path,pixelId,choice]);
 useEffect(()=>{
  if(!pixelId||(path!=='/'&&!isStoreMarketingPath(path)))return;
  const open=(event:Event)=>{event.preventDefault();setEditing(true);};
  window.addEventListener('ocdl-open-marketing',open);
  return()=>window.removeEventListener('ocdl-open-marketing',open);
 },[path,pixelId]);
 if(choice===undefined||!pixelId||(path!=='/'&&!isStoreMarketingPath(path)))return null;
 async function save(consent:boolean){
  setPending(true);setError('');
  // Apply the local privacy choice immediately; network latency must not hold the banner open.
  if(!consent)window.fbq?.('consent','revoke');
  writeMarketingChoice(consent);
  setEditing(false);
  if(!consent){for(const name of ['_fbp','_fbc']){document.cookie=`${name}=; Max-Age=0; Path=/`;document.cookie=`${name}=; Max-Age=0; Path=/; Domain=.${location.hostname.replace(/^www\./,'')}`;}}
  try{
   await syncMarketingChoice(consent,true);
  }catch{setError('Sua escolha já vale neste navegador. Falta sincronizar com o servidor.');}finally{setPending(false);}
 }
 return <>
  {error&&!editing&&<div role="status" className="fixed bottom-36 left-2 z-40 max-w-xs rounded-lg border bg-background p-3 text-xs shadow">{error} <button type="button" disabled={pending} className="underline" onClick={()=>void save(choice===true)}>Tentar novamente</button></div>}
  {(choice===null||editing)&&<section aria-label="Preferências de publicidade" className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 mx-auto max-w-xl rounded-xl border bg-background p-3 text-foreground shadow-lg sm:inset-x-auto sm:right-4 sm:bottom-4 sm:max-w-sm">
   <p className="text-xs leading-relaxed">Podemos usar cookies e tecnologias da Meta para medir visitas, cliques e compras e melhorar anúncios? Você pode continuar sem aceitar. <a href="/privacidade-loja" className="font-medium underline">Saiba mais</a></p>
   <div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={pending} onClick={()=>void save(false)} className="min-h-11 flex-1 rounded-lg border px-3 py-2 text-xs font-medium">Recusar publicidade</button><button type="button" disabled={pending} onClick={()=>void save(true)} className="min-h-11 flex-1 rounded-lg border bg-amarelo px-3 py-2 text-xs font-medium text-black">Aceitar publicidade</button>{choice!==null&&<button type="button" disabled={pending} className="min-h-11 px-3 py-2 text-xs underline" onClick={()=>setEditing(false)}>Fechar</button>}</div>
   {error&&<p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
  </section>}
 </>;
}
