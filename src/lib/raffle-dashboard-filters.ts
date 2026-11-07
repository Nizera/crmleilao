import { z } from "zod";
import type { RaffleSummaryOrder } from "@/lib/raffle-presentation";
export function dashboardCampaignSelection(value: string | string[] | undefined) {
 const raw=value===undefined?[]:Array.isArray(value)?value:[value];
 const ids=[...new Set(raw.filter(id=>z.uuid().safeParse(id).success).map(id=>id.toLowerCase()))].slice(0,100);
 return {ids,active:raw.length>0,invalid:raw.some(id=>!z.uuid().safeParse(id).success)||raw.length>100};
}
export function raffleDashboardOrders(orders:RaffleSummaryOrder[],ids?:string[]) {
 if(ids===undefined)return orders;
 const selected=new Set(ids);return orders.filter(order=>selected.has(order.campaign_id));
}
export type DashboardCampaignOption={id:string;title:string;status:string;total_numbers:number;paid:number|null;archived:boolean};
