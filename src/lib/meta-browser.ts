'use client';
import {CONSENT_DAYS,CONSENT_VERSION,isStoreMarketingPath} from '@/lib/meta-commerce';
import type {StoreProduct} from '@/lib/store';
type MetaQueue=((...args:unknown[])=>void)&{queue?:unknown[][];push?:MetaQueue;loaded?:boolean;version?:string;callMethod?:MetaQueue};
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
export function enableStorePixel(pixel:string) {
 if(!/^\d{5,30}$/.test(pixel)||!isStoreMarketingPath(location.pathname)||readMarketingChoice()!==true)return;
 if(!window.fbq){
  const q:MetaQueue=(...args)=>{if(q.callMethod)q.callMethod(...args);else(q.queue??=[]).push(args);};
  q.push=q;q.loaded=true;q.version='2.0';q.queue=[];window.fbq=q;window._fbq=q;
  const script=document.createElement('script');script.async=true;script.src='https://connect.facebook.net/en_US/fbevents.js';script.id='ocdl-meta-pixel';document.head.appendChild(script);
 }
 if(initializedPixel!==pixel){window.fbq('set','autoConfig',false,pixel);window.fbq('init',pixel);initializedPixel=pixel;}
 window.fbq('consent','grant');
}
export function trackStoreEvent(name:'PageView'|'ViewContent'|'AddToCart'|'InitiateCheckout'|'Search',data:Record<string,unknown>={}) {
 if(readMarketingChoice()!==true||!isStoreMarketingPath(location.pathname)||!initializedPixel||!window.fbq)return;
 window.fbq('trackSingle',initializedPixel,name,data,{eventID:crypto.randomUUID()});
}
export function trackStoreProduct(name:'ViewContent'|'AddToCart',product:StoreProduct) {
 if(!(Number(product.cash_price)>0)||Number(product.points_cost)>0)return;
 trackStoreEvent(name,{currency:'BRL',value:Number(product.cash_price),content_type:'product',content_ids:[product.id],contents:[{id:product.id,quantity:1,item_price:Number(product.cash_price)}],content_category:product.category});
}
function cookie(name:string){return document.cookie.split('; ').find(x=>x.startsWith(name+'='))?.slice(name.length+1)??null;}
export async function syncMarketingChoice(consent:boolean,explicit=false) {
 const params=new URLSearchParams(location.search),attribution=Object.fromEntries(['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].map(k=>[k,params.get(k)]));
 const click=params.get('fbclid');
 const fbc=click&&/^[A-Za-z0-9_-]{1,400}$/.test(click)?`fb.1.${Date.now()}.${click}`:cookie('_fbc');
 const response=await fetch('/api/store/marketing',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',
  body:JSON.stringify({consent,refresh:!explicit,source_path:location.pathname,attribution,fbp:consent?cookie('_fbp'):null,fbc:consent?fbc:null})});
 const result=await response.json();if(!response.ok||!result.ok)throw new Error('Não foi possível salvar sua preferência. Tente novamente.');
}
export async function prepareStoreMarketing(){if(readMarketingChoice()===true)await syncMarketingChoice(true).catch(()=>{});}
