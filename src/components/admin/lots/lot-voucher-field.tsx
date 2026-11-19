"use client";
import {useEffect,useState} from "react";
import {Ticket} from "lucide-react";
import {getLotVouchers,type AuctionVoucher} from "@/app/actions/auction-vouchers";
import {formatBRL} from "@/lib/lots";
import {Input} from "@/components/ui/input";

export function LotVoucherField({customer,lot,id,amount,maximum,disabled,onChange}:{customer?:string;lot?:string;id:string;amount:string;maximum:number;disabled:boolean;onChange:(id:string,amount:string)=>void}) {
 const [attempt,setAttempt]=useState(0);
 const [result,setResult]=useState<{key:string;vouchers:AuctionVoucher[];error:string}|null>(null);
 const key=`${customer??""}:${lot??""}:${attempt}`;
 const loading=Boolean(customer&&result?.key!==key);
 const vouchers=result?.key===key?result.vouchers:[];
 const error=result?.key===key?result.error:"";
 useEffect(()=>{
  let disposed=false;
  if(!customer)return;
  getLotVouchers(customer,lot).then(response=>{if(!disposed)setResult({key,vouchers:response.ok?response.data:[],error:response.ok?"":response.error});}).catch(()=>{if(!disposed)setResult({key,vouchers:[],error:"Não foi possível consultar o saldo."});});
  return()=>{disposed=true;};
 },[customer,lot,key]);
 const selected=vouchers.find(v=>v.id===id);
 const credit=Number(amount.replace(",","."))||0;
 return <section aria-label="Voucher do cliente" className="rounded-xl border-2 border-yellow-500/70 bg-yellow-50 p-4 text-zinc-950 shadow-sm dark:bg-yellow-950/30 dark:text-yellow-50">
  <div className="flex items-center gap-2 text-lg font-bold"><Ticket className="size-6 shrink-0"/>Voucher do cliente</div>
  <div aria-live="polite" className="my-2">
   {!customer?<p className="text-sm">Selecione o cliente na busca para conferir os vouchers.</p>:loading?<p className="text-sm">Consultando crédito disponível…</p>:error?<p role="alert" className="text-sm">{error} <button type="button" className="underline" onClick={()=>setAttempt(n=>n+1)}>Tentar novamente</button></p>:<p className="text-2xl font-bold tabular-nums">{formatBRL(vouchers.reduce((sum,v)=>sum+Number(v.available),0))}<span className="ml-2 text-sm font-normal">disponíveis para os lotes</span></p>}
  </div>
  {customer&&!loading&&!error&&vouchers.length>0&&<div className="grid gap-3 sm:grid-cols-2">
   <label className="grid gap-1 text-sm font-semibold">Voucher<select className="h-10 min-w-0 rounded-md border bg-background px-2 text-foreground" value={id} disabled={disabled} onChange={e=>onChange(e.target.value,"")}><option value="">Não utilizar neste lote</option>{vouchers.map(v=><option key={v.id} value={v.id}>{v.title} · {formatBRL(v.available)}</option>)}</select></label>
   <label className="grid gap-1 text-sm font-semibold">Usar neste lote (R$)<Input aria-label="Valor do voucher neste lote" inputMode="decimal" placeholder="0,00" value={amount} disabled={disabled||!selected} onChange={e=>onChange(id,e.target.value)}/></label>
   {selected&&<div className="sm:col-span-2"><button type="button" className="text-sm font-semibold underline" disabled={disabled} onClick={()=>onChange(id,String(Math.max(0,Math.min(Number(selected.available),maximum))))}>Usar o máximo disponível neste lote</button><p className="mt-2 font-semibold">Voucher aplicado: {formatBRL(credit)} · Saldo após salvar: {formatBRL(Math.max(0,Number(selected.available)-credit))}</p>{credit>Number(selected.available)&&<p role="alert">O valor ultrapassa o saldo disponível.</p>}</div>}
  </div>}
  <p className="mt-3 text-xs">Crédito exclusivo dos arremates. O frete permanece separado, mesmo se o voucher cobrir todo o lote. O saldo é conferido novamente ao salvar.</p>
 </section>;
}
