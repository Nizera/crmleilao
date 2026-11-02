import "server-only";
import type { AuctionPeriod } from "@/lib/auction-period";
import { createAdminClient } from "@/lib/supabase/admin";
import type { FreightReceipt } from "@/lib/period-receipts";
export async function loadFreightReceipts(db:ReturnType<typeof createAdminClient>,period:AuctionPeriod){
  const read=async(table:string,status:string)=>{
    const rows:FreightReceipt[]=[];
    for(let offset=0;;offset+=500){
      const {data,error}=await db.from(table).select("id,customer_id,paid_at,freight_amount").eq(table==="charges"?"status":"payment_status",status).gt("freight_amount",0).gte("paid_at",period.startUtc).lt("paid_at",period.endUtc).order("paid_at").order("id").range(offset,offset+499);
      if(error)throw new Error("Não foi possível conferir os fretes recebidos no período.");
      const page=(data??[]) as Omit<FreightReceipt,"status">[];rows.push(...page.map(r=>({...r,status})));if(page.length<500)return rows;
    }
  };
  const [charges,store]=await Promise.all([read("charges","approved"),read("store_orders","paid")]);return {charges,store};
}
