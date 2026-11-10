"use client";
import {useState,useTransition} from "react";
import {useRouter} from "next/navigation";
import {toast} from "sonner";
import {ShieldAlert,Unlock} from "lucide-react";
import {manageCustomerAccess} from "@/app/actions/customer-access";
import {Button} from "@/components/ui/button";
import {Textarea} from "@/components/ui/textarea";

export function CustomerAccess({customer,count,blocked,events}:{customer:string;count:number;blocked:boolean;events:{id:string;kind:string;reason:string;created_at:string}[]}){
 const router=useRouter();const [reason,setReason]=useState("");const [pending,start]=useTransition();
 const [request,setRequest]=useState<string|null>(null);
 function submit(action:"warning"|"unblock"){
  if(reason.trim().length<3){toast.error("Informe o motivo.");return;}
  if(!window.confirm(action==="unblock"?"Liberar acesso e reiniciar a contagem de advertências? O histórico será mantido.":"Aplicar advertência? Na terceira, o acesso do cliente será bloqueado."))return;
  const key=request??crypto.randomUUID();setRequest(key);
  start(async()=>{const result=await manageCustomerAccess({customer,request:key,action,reason});if(!result.ok){toast.error(result.error);return;}setRequest(null);setReason("");toast.success(action==="unblock"?"Acesso liberado. Contagem reiniciada.":"Advertência registrada.");router.refresh();});
 }
 return <section className="rounded-xl border p-4 sm:p-5">
  <h3 className="flex items-center gap-2 font-semibold"><ShieldAlert className="size-5"/>Advertências e acesso</h3>
  <p className="mt-2 text-sm">{blocked?"Acesso bloqueado":"Acesso liberado"} · {count}/3 advertências</p>
  <p className="mt-1 text-sm text-muted-foreground">Lotes vencidos do mesmo dia de leilão geram uma única advertência, mesmo que expirem em horários diferentes. Na terceira advertência, o painel é bloqueado. Liberar reinicia a contagem e preserva o histórico.</p>
  <label htmlFor="access-reason" className="mt-4 block text-sm font-medium">Motivo da ação administrativa</label>
  <Textarea id="access-reason" value={reason} maxLength={500} disabled={pending} onChange={e=>{setReason(e.target.value);setRequest(null);}} placeholder="Explique a advertência ou a liberação" className="mt-2"/>
  <div className="mt-3 flex flex-wrap gap-2">
   {!blocked&&<Button variant="outline" disabled={pending||reason.trim().length<3} onClick={()=>submit("warning")}><ShieldAlert/>Aplicar advertência</Button>}
   {count>0&&<Button disabled={pending||reason.trim().length<3} onClick={()=>submit("unblock")}><Unlock/>{blocked?"Liberar acesso":"Reiniciar advertências"}</Button>}
  </div>
  <details className="mt-4 border-t pt-3 text-sm"><summary className="cursor-pointer font-medium">Histórico recente</summary>
   {events.length===0?<p className="mt-2 text-muted-foreground">Nenhuma advertência registrada.</p>:<ul className="mt-2 space-y-3">{events.map(e=><li key={e.id}><p className="font-medium">{e.kind==="warning"?"Advertência":"Liberação administrativa"} · {new Date(e.created_at).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})}</p><p className="break-words text-muted-foreground">{e.reason}</p></li>)}</ul>}
  </details>
 </section>;
}
