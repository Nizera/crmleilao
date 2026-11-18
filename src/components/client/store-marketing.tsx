'use client';
import {useEffect,useState,useSyncExternalStore} from 'react';
import {usePathname} from 'next/navigation';
import {isStoreMarketingPath} from '@/lib/meta-commerce';
import {enableStorePixel,readMarketingChoice,subscribeMarketingChoice,syncMarketingChoice,trackStoreEvent,writeMarketingChoice} from '@/lib/meta-browser';

export function StoreMarketing({pixelId}:{pixelId:string|null}) {
 const path=usePathname();const choice=useSyncExternalStore(subscribeMarketingChoice,readMarketingChoice,()=>undefined);
 const [editing,setEditing]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  if(!pixelId||!isStoreMarketingPath(path)||choice!==true){window.fbq?.('consent','revoke');return;}
  enableStorePixel(pixelId);trackStoreEvent('PageView');
  void syncMarketingChoice(true).catch(()=>{});
  return()=>{window.fbq?.('consent','revoke');};
 },[path,pixelId,choice]);
 if(choice===undefined||!pixelId||!isStoreMarketingPath(path))return null;
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
  {choice!==null&&!editing&&<button type="button" className="fixed bottom-24 left-2 z-40 rounded-lg border bg-background px-3 py-2 text-xs shadow" onClick={()=>setEditing(true)}>Privacidade da loja</button>}
  {error&&!editing&&<div role="status" className="fixed bottom-36 left-2 z-40 max-w-xs rounded-lg border bg-background p-3 text-xs shadow">{error} <button type="button" disabled={pending} className="underline" onClick={()=>void save(choice===true)}>Tentar novamente</button></div>}
  {(choice===null||editing)&&<section aria-label="Preferências de publicidade" className="fixed inset-x-3 bottom-24 z-50 mx-auto max-w-xl rounded-xl border bg-background p-4 text-foreground shadow-xl">
   <p className="font-semibold">Publicidade e privacidade</p>
   <p className="mt-2 text-sm">Com sua autorização, usamos o Pixel e a API de Conversões da Meta para medir visitas e vendas da loja e melhorar anúncios. Podemos compartilhar identificadores do navegador, dados dos produtos e e-mail e telefone transformados em códigos. A loja funciona mesmo se você recusar.</p>
   <p className="mt-2 text-xs text-muted-foreground">Sua escolha vale por até 180 dias e pode ser alterada em “Privacidade da loja”. Cookies de login e carrinho continuam necessários. <a href="/privacidade-loja" className="underline">Saiba mais</a>.</p>
   <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={pending} onClick={()=>void save(false)} className="rounded-lg border px-4 py-2 text-sm">Recusar publicidade</button><button type="button" disabled={pending} onClick={()=>void save(true)} className="rounded-lg border bg-amarelo px-4 py-2 text-sm text-black">Aceitar publicidade</button>{choice!==null&&<button type="button" disabled={pending} className="px-3 text-sm underline" onClick={()=>setEditing(false)}>Fechar</button>}</div>
   {error&&<p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
  </section>}
 </>;
}
