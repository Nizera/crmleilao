"use server";
import {z} from "zod";
import {requireAdmin} from "@/lib/dal";
import {createClient} from "@/lib/supabase/server";
import {rethrowIfRedirect, type ActionResult} from "@/lib/result";
export type AuctionVoucher = {id:string;title:string;amount:number;remaining:number;available:number};
export async function getLotVouchers(customer:string,lot?:string):Promise<ActionResult<AuctionVoucher[]>> {
 try {
  await requireAdmin();
  if(!z.uuid().safeParse(customer).success||(lot&&!z.uuid().safeParse(lot).success))return {ok:false,error:"Cliente ou lote inválido."};
  const {data,error}=await (await createClient()).rpc("get_auction_vouchers",{p_customer:customer,p_lot:lot??null});
  if(error)return {ok:false,error:"Não foi possível consultar os vouchers. Atualize antes de usar crédito."};
  return {ok:true,data:data??[]};
 }catch(error){rethrowIfRedirect(error);return {ok:false,error:"Não foi possível consultar os vouchers."};}
}
