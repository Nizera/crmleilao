"use client";
import {useEffect,useTransition} from "react";
import {useRouter} from "next/navigation";
import {RefreshCw} from "lucide-react";
import {readSelfRaffleAwardsState} from "@/app/actions/raffle-awards-state";
import {Button} from "@/components/ui/button";

export function RaffleAwardsSync({signature,page}:{signature:string;page:number}){
 const router=useRouter();const [pending,start]=useTransition();
 useEffect(()=>{
  let checking=false,disposed=false;
  const check=async()=>{
   if(checking||document.visibilityState!=="visible")return;
   checking=true;
   try{const result=await readSelfRaffleAwardsState(page);if(!disposed&&result.ok&&result.data.signature!==signature)router.refresh();}
   catch{/* Não apaga prêmios se a conexão falhar. */}finally{checking=false;}
  };
  const timer=setInterval(()=>void check(),90000);
  document.addEventListener("visibilitychange",check);
  return()=>{disposed=true;clearInterval(timer);document.removeEventListener("visibilitychange",check);};
 },[signature,page,router]);
 return <Button type="button" variant="outline" size="sm" className="w-fit" disabled={pending} onClick={()=>start(()=>router.refresh())}><RefreshCw size={15} className={pending?"animate-spin":""}/>{pending?"Atualizando…":"Atualizar meus prêmios"}</Button>;
}
