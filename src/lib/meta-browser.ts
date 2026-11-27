'use client';
import {CONSENT_DAYS,CONSENT_VERSION,isStoreMarketingPath} from '@/lib/meta-commerce';
import type {StoreProduct} from '@/lib/store';
type MetaQueue=((...args:unknown[])=>void)&{queue?:unknown[][];push?:MetaQueue;loaded?:boolean;version?:string;callMethod?:MetaQueue;disablePushState?:boolean};
declare global {interface Window {fbq?:MetaQueue;_fbq?:MetaQueue;}}
export const CONSENT_KEY='ocdl-store-marketing-choice-v1';
let memoryChoice:string|null=null;
export function writeMarketingChoice(consent:boolean){
 memoryChoice=JSON.stringify({consent,version:CONSENT_VERSION,at:Date.now()});
 try{localStorage.setItem(CONSENT_KEY,memoryChoice);}catch{/* The choice still applies to this visit. */}
 window.dispatchEvent(new Event('ocdl-marketing-choice'));
}
export function subscribeMarketingChoice(notify:()=>void){const storage=()=>{memoryChoice=null;notify();};window.addEventListener('ocdl-marketing-choice',notify);window.addEventListener('storage',storage);return()=>{window.removeEventListener('ocdl-marketing-choice',notify);window.removeEventListener('storage',storage);};}
export function readMarketingChoice():boolean|null {
 try{const v=JSON.parse(memoryChoice??localStorage.getItem(CONSENT_KEY)??'null');return v?.version===CONSENT_VERSION&&Date.now()-v.at<CONSENT_DAYS*86400000&&typeof v.consent==='boolean'?v.consent:null;}catch{return null;}
}
let initializedPixel='';
// Landing measurement is independent of store consent; saved refusals still apply.
function canMeasure(landing:boolean){const choice=readMarketingChoice();return landing&&location.pathname==='/'?choice!==false:choice===true;}
let lastPageView:string|null=null;
const sentEvents=new Set<string>();
export function leaveStoreMarketing(){lastPageView=null;window.fbq?.('consent','revoke');}
export function enableStorePixel(pixel:string,landing=false) {
 if(!/^\d{5,30}$/.test(pixel)||!(isStoreMarketingPath(location.pathname)||(landing&&location.pathname==='/'))||!canMeasure(landing))return;
 if(!window.fbq){
  const q:MetaQueue=(...args)=>{if(q.callMethod)q.callMethod(...args);else(q.queue??=[]).push(args);};
  q.push=q;q.loaded=true;q.version='2.0';q.queue=[];q.disablePushState=true;window.fbq=q;window._fbq=q;
  const script=document.createElement('script');script.async=true;script.src='https://connect.facebook.net/en_US/fbevents.js';script.id='ocdl-meta-pixel';document.head.appendChild(script);
 }
 window.fbq.disablePushState=true;
 if(initializedPixel!==pixel){window.fbq('set','autoConfig',false,pixel);window.fbq('init',pixel);initializedPixel=pixel;}
 window.fbq('consent','grant');
}
export function trackStoreEvent(name:'PageView'|'ViewContent'|'AddToCart'|'InitiateCheckout'|'Search'|'Lead',data:Record<string,unknown>={},eventId?:string,landing=false) {
 if(!canMeasure(landing)||!(isStoreMarketingPath(location.pathname)||(landing&&location.pathname==='/'))||!initializedPixel||!window.fbq)return false;
 const page=initializedPixel+':'+location.pathname;
 if(name==='PageView'&&lastPageView===page)return false;
 const id=eventId??crypto.randomUUID(),key=initializedPixel+':'+name+':'+id;
 if(sentEvents.has(key))return false;
 window.fbq('trackSingle',initializedPixel,name,data,{eventID:id});
 if(name==='PageView')lastPageView=page;
 sentEvents.add(key);if(sentEvents.size>500)sentEvents.delete(sentEvents.values().next().value!);
 return true;
}
export function trackStoreProduct(name:'ViewContent'|'AddToCart',product:StoreProduct) {
 if(!(Number(product.cash_price)>0)||Number(product.points_cost)>0)return;
 trackStoreEvent(name,{currency:'BRL',value:Number(product.cash_price),content_type:'product',content_ids:[product.id],contents:[{id:product.id,quantity:1,item_price:Number(product.cash_price)}],content_category:product.category});
}
export function trackAuctionInviteClick() {
 if(location.pathname==='/'&&canMeasure(true)&&initializedPixel&&window.fbq)
  window.fbq('trackSingleCustom',initializedPixel,'AuctionWhatsAppInviteClick');
}
function cookie(name:string){return document.cookie.split('; ').find(x=>x.startsWith(name+'='))?.slice(name.length+1)??null;}
export async function syncMarketingChoice(consent:boolean,explicit=false) {
 const params=new URLSearchParams(location.search),attribution=Object.fromEntries(['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].map(k=>[k,params.get(k)]));
 const click=params.get('fbclid');
 const fbc=click&&/^[A-Za-z0-9_-]{1,400}$/.test(click)?`fb.1.${Date.now()}.${click}`:cookie('_fbc');
 const response=await fetch('/api/store/marketing',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',
  signal:AbortSignal.timeout(5000),
  body:JSON.stringify({consent,refresh:!explicit,source_path:location.pathname,attribution,fbp:consent?cookie('_fbp'):null,fbc:consent?fbc:null})});
 const result=await response.json();if(!response.ok||!result.ok)throw new Error('Não foi possível salvar sua preferência. Tente novamente.');
}
export async function prepareStoreMarketing(){if(readMarketingChoice()===true)await syncMarketingChoice(true).catch(()=>{});}

let landingVisitId='';
let landingLeadSent=false;
/** One outbound group click per tab session; never a confirmed WhatsApp membership. */
export function trackLandingLead(placement:string) {
 if(new URLSearchParams(location.search).get('entrada')==='pre-cadastro')return;
 if(location.pathname!=='/'||!canMeasure(true)||!initializedPixel||!window.fbq||landingLeadSent)return;
 let id=landingVisitId||(landingVisitId=crypto.randomUUID());
 const sentKey='ocdl-landing-lead-sent:'+initializedPixel;
 try{
  if(sessionStorage.getItem(sentKey))return;
  id=sessionStorage.getItem('ocdl-landing-lead-session')??id;
  sessionStorage.setItem('ocdl-landing-lead-session',id);
 }catch{/* A unique in-memory ID still avoids shared fallback IDs between visitors. */}
 const sent=trackStoreEvent('Lead',{content_name:'Grupo de leilões Legends',content_category:'Figurinhas Legends',lead_source:'landing_whatsapp',placement},id,true);
 if(sent){landingLeadSent=true;try{sessionStorage.setItem(sentKey,id);}catch{/* Memory applies for this page visit. */}}
}
