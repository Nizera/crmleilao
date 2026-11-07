"use client";
import {useState,useTransition} from "react";
import {useRouter} from "next/navigation";
import {Dialog} from "radix-ui";
import {Pencil,Trash2,X} from "lucide-react";
import {toast} from "sonner";
import {editRaffleInstantPrize} from "@/app/actions/raffles";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
export function InstantPrizeActions({prize,blockedReason}:{prize:{id:string;title:string};blockedReason?:string}){
 const router=useRouter();const [open,setOpen]=useState(false),[title,setTitle]=useState(prize.title),[error,setError]=useState("");const[pending,start]=useTransition();
 function run(action:"edit"|"delete"){
  if(blockedReason){toast.info(blockedReason);return;}
  if(action==="delete"&&!confirm(`Excluir o prêmio “${prize.title}”? O número continua disponível para compra, mas sem este prêmio.`))return;
  start(async()=>{setError("");try{const r=await editRaffleInstantPrize({id:prize.id,action,title,expectedTitle:prize.title});if(!r.ok){setError(r.error);if(action==="delete")toast.error(r.error);return;}toast.success(action==="edit"?"Prêmio atualizado.":"Prêmio excluído.");setOpen(false);router.refresh();}catch{setError("Não foi possível confirmar. Atualize a página antes de repetir.");toast.error("Não foi possível confirmar a alteração. Atualize a página.");}});
 }
 return <div className="flex items-center gap-1"><Dialog.Root open={open} onOpenChange={value=>{if(!pending){if(value){setTitle(prize.title);setError("");}setOpen(value);}}}><Dialog.Trigger asChild><Button size="icon" variant="ghost" type="button" disabled={pending} aria-disabled={Boolean(blockedReason)||pending} onClick={event=>{if(blockedReason){event.preventDefault();toast.info(blockedReason);}}} aria-label={`Editar ${prize.title}`} title={blockedReason||"Editar prêmio"}><Pencil size={15}/></Button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/60"/><Dialog.Content className="fixed left-1/2 top-1/2 z-50 grid max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-2xl border bg-background p-5" onInteractOutside={e=>{if(pending)e.preventDefault();}}><div className="flex items-start justify-between gap-3"><Dialog.Title className="font-bold">Editar cota premiada</Dialog.Title><Dialog.Close asChild><Button size="icon" variant="ghost" disabled={pending} aria-label="Fechar"><X size={16}/></Button></Dialog.Close></div><Dialog.Description className="text-sm text-muted-foreground">Altere o nome do prêmio. O número atribuído e as fotos são preservados. Use o botão Fotos para trocar as imagens.</Dialog.Description><form className="grid gap-4" onSubmit={e=>{e.preventDefault();run("edit");}}><label className="grid gap-2 text-sm">Nome do prêmio<Input autoFocus maxLength={160} required value={title} onChange={e=>setTitle(e.target.value)} disabled={pending}/></label>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}<Button disabled={pending||!title.trim()}>{pending?"Salvando…":"Salvar alterações"}</Button></form></Dialog.Content></Dialog.Portal></Dialog.Root><Button size="icon" variant="ghost" type="button" disabled={pending} aria-disabled={Boolean(blockedReason)||pending} aria-label={`Excluir ${prize.title}`} title={blockedReason||"Excluir prêmio"} onClick={()=>run("delete")}><Trash2 size={15}/></Button></div>;
}
