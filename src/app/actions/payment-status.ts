"use server";

import { z } from "zod";
import { requireCustomer } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { rethrowIfRedirect, type ActionResult } from "@/lib/result";

type PaymentState = { id: string; status: string; hasQr: boolean; expiresAt: string | null };

/** Consulta barata: só dados do próprio cliente; sem MP, mutação ou invalidação de cache. */
export async function readSelfPaymentStates(kind: "auction" | "store" | "raffle", ids: string[]): Promise<ActionResult<PaymentState[]>> {
  try {
    const parsed=z.object({kind:z.enum(["auction","store","raffle"]),ids:z.array(z.uuid()).min(1).max(20)}).safeParse({kind,ids});
    if(!parsed.success)return {ok:false,error:"Consulta inválida."};
    const {customer}=await requireCustomer();
    const db=await createClient();
    const table=parsed.data.kind==="auction"?"charges":parsed.data.kind==="store"?"store_orders":"raffle_orders";
    const columns=parsed.data.kind==="store"?"id,status:payment_status,qr_code,expires_at":"id,status,qr_code,expires_at";
    const {data,error}=await db.from(table).select(columns).eq("customer_id",customer.id).in("id",[...new Set(parsed.data.ids)]);
    if(error)return {ok:false,error:"Não foi possível consultar o pagamento."};
    const rows=data as unknown as {id:string;status:string;qr_code:string|null;expires_at:string|null}[];
    return {ok:true,data:rows.map(row=>({id:row.id,status:row.status,hasQr:Boolean(row.qr_code),expiresAt:row.expires_at}))};
  }catch(error){rethrowIfRedirect(error);return {ok:false,error:"Não foi possível consultar o pagamento."};}
}
