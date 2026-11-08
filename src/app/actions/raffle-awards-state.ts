"use server";
import {requireCustomer} from "@/lib/dal";
import {createClient} from "@/lib/supabase/server";
import {rethrowIfRedirect,type ActionResult} from "@/lib/result";
import {raffleAwardsSignature} from "@/lib/raffle-awards-state";
import type {RaffleAward} from "@/lib/raffles";

export async function readSelfRaffleAwardsState(page:number):Promise<ActionResult<{signature:string}>>{
 try{
  if(!Number.isInteger(page)||page<1||page>10000)return {ok:false,error:"Página inválida."};
  const {customer}=await requireCustomer();
  const {data,error}=await(await createClient()).rpc("get_raffle_awards",{p_page:page});
  if(error)return {ok:false,error:"Não foi possível atualizar seus prêmios."};
  const rows=(data??[]) as RaffleAward[];
  return {ok:true,data:{signature:raffleAwardsSignature(rows.filter(row=>row.customer_id===customer.id))}};
 }catch(error){rethrowIfRedirect(error);return {ok:false,error:"Não foi possível atualizar seus prêmios."};}
}
