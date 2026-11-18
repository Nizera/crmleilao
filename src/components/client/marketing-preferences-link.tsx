'use client';
import type {MouseEvent} from 'react';
export function MarketingPreferencesLink(){
 function open(event:MouseEvent<HTMLAnchorElement>){
  const request=new Event('ocdl-open-marketing',{cancelable:true});
  if(!window.dispatchEvent(request))event.preventDefault();
 }
 return <a href="/privacidade-loja" onClick={open} className="inline-block text-xs opacity-75 underline-offset-4 hover:opacity-100 hover:underline focus-visible:outline focus-visible:outline-offset-4">Privacidade e cookies</a>;
}
