"use server";
import {z} from "zod";
import {requireAdmin} from "@/lib/dal";
import {createClient} from "@/lib/supabase/server";
import {rethrowIfRedirect,type ActionResult} from "@/lib/result";
import {createCustomerLotsPdf,customerPdfFilename,validateCustomerPdfLots,MAX_CUSTOMER_PDF_LOTS,type CustomerPdfLot} from "@/lib/customer-lots-pdf";

export async function downloadCustomerLotsPdf(rawIds:unknown):Promise<ActionResult<{filename:string;base64:string}>>{
  try{
    await requireAdmin();
    const parsed=z.array(z.uuid()).min(1).max(MAX_CUSTOMER_PDF_LOTS).safeParse(rawIds);
    if(!parsed.success)return {ok:false,error:"Selecione de 1 a 200 lotes válidos."};
    const ids=parsed.data;
    if(new Set(ids).size!==ids.length)return {ok:false,error:"A seleção contém lotes repetidos."};
    const db=await createClient();const lots:CustomerPdfLot[]=[];
    for(let from=0;from<ids.length;from+=100){
      const result=await db.from("lots").select("id,code,title,description,auction_date,arremate_value,discount_amount,status,customer_id").in("id",ids.slice(from,from+100));
      if(result.error)return {ok:false,error:"Não foi possível carregar os lotes. Atualize a página e tente novamente."};
      lots.push(...(result.data??[]).map(lot=>({...lot,arremate_value:Number(lot.arremate_value),discount_amount:Number(lot.discount_amount??0)})));
    }
    if(lots.length!==ids.length)return {ok:false,error:"Um lote não está mais disponível. Atualize a seleção."};
    const customerId=validateCustomerPdfLots(lots);
    const customer=await db.from("customers").select("name").eq("id",customerId).single();
    if(customer.error||!customer.data)return {ok:false,error:"Não foi possível conferir o cliente."};
    const name=customer.data.name?.trim()||"Cliente";
    lots.sort((a,b)=>a.auction_date.localeCompare(b.auction_date)||a.code.localeCompare(b.code));
    const bytes=await createCustomerLotsPdf(name,lots);
    return {ok:true,data:{filename:customerPdfFilename(name),base64:Buffer.from(bytes).toString("base64")}};
  }catch(error){rethrowIfRedirect(error);return {ok:false,error:error instanceof Error && /Selecione|seleção|cancelados|valores/.test(error.message)?error.message:"Não foi possível gerar o PDF. Atualize a página e tente novamente."};}
}
