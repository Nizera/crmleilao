import "server-only";
import {createAdminClient} from "@/lib/supabase/admin";
import type {ShipmentQueueRow} from "@/lib/shipments-server";
import {matchesShipmentItem,shipmentSearchKey} from "./shipment-item-search";

async function readPages<T>(query:(from:number,to:number)=>PromiseLike<{data:T[]|null;error:unknown}>):Promise<T[]> {
  const rows:T[]=[];
  for(let from=0;;from+=500){
    const result=await query(from,from+499);
    if(result.error)throw new Error("Não foi possível pesquisar os prêmios e produtos dos envios.");
    rows.push(...result.data??[]);
    if((result.data?.length??0)<500)return rows;
  }
}

/** Consultas em lotes: pesquisa apenas conteúdo da remessa exibida. */
export async function findShipmentItems(rows: ShipmentQueueRow[], query: string, day: string): Promise<string[]> {
  if (!query.trim()) return rows.map(shipmentSearchKey);
  const admin = createAdminClient();
  const texts = new Map(rows.map(row=>[shipmentSearchKey(row),row.lots.map(l=>`${l.code} ${l.title}`).join(" ")]));
  const add = (key:string,text:string) => texts.set(key,`${texts.get(key)??""} ${text}`);
  const lotIds = [...new Set(rows.flatMap(row=>row.lots.map(l=>l.id)))];
  for (let offset=0;offset<lotIds.length;offset+=100) {
    const result = await admin.from("lots").select("id,title,description,items:lot_items(color,player:players(name))").in("id",lotIds.slice(offset,offset+100));
    if(result.error) throw new Error("Não foi possível pesquisar os itens dos lotes.");
    for(const lot of result.data??[]) {
      const text = `${lot.title} ${lot.description??""} ${(lot.items??[]).map(item=>`${item.color} ${(Array.isArray(item.player)?item.player[0]:item.player)?.name??""}`).join(" ")}`;
      for(const row of rows) if(row.lots.some(l=>l.id===lot.id))add(shipmentSearchKey(row),text);
    }
  }
  const customers=[...new Set(rows.map(row=>row.customerId))];
  for(let offset=0;offset<customers.length;offset+=100){
    const ids=customers.slice(offset,offset+100);
    const [issues,orders]=await Promise.all([
      readPages((from,to)=>admin.from("logistics_pending").select("customer_id,title,reason,shipping_date,shipment_id").in("customer_id",ids).is("cancelled_at",null).order("id").range(from,to)),
      readPages((from,to)=>admin.from("store_orders").select("customer_id,shipment_id,items:store_order_items(name,delivery_kind)").in("customer_id",ids).eq("payment_status","paid").order("id").range(from,to)),
    ]);
    for(const row of rows.filter(row=>ids.includes(row.customerId))){
      for(const issue of issues)if(issue.customer_id===row.customerId && (row.pendingShipment ? issue.shipment_id===row.pendingShipment.id : !issue.shipment_id && issue.shipping_date===day))add(shipmentSearchKey(row),`${issue.title} ${issue.reason}`);
      for(const order of orders)if(order.customer_id===row.customerId && (row.pendingShipment ? order.shipment_id===row.pendingShipment.id : !order.shipment_id && !!row.storeOrderCount))add(shipmentSearchKey(row),(order.items??[]).filter(i=>i.delivery_kind==='physical').map(i=>i.name).join(" "));
    }
  }
  return [...texts].filter(([,text])=>matchesShipmentItem(text,query.slice(0,160))).map(([key])=>key);
}
