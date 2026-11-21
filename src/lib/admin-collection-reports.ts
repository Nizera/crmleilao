import {LOYALTY_TIERS} from "@/lib/loyalty-tiers";
export const VOUCHER_FILTERS={all:"Todos os vouchers",available:"Com saldo disponível",reserved:"Vinculados a lotes pendentes",used:"Utilizados em lotes quitados",review:"Em revisão"} as const;
export function collectionReportFilters(params:Record<string,string|string[]|undefined>){
 const first=(key:string)=>Array.isArray(params[key])?params[key][0]??"":params[key]??"";
 return {query:first("q").trim().slice(0,120),page:Math.max(1,Math.min(10000,Math.trunc(Number(first("p"))||1))),
  status:Object.hasOwn(VOUCHER_FILTERS,first("status"))?first("status"):"all",
  tier:LOYALTY_TIERS.some(t=>t.key===first("elo"))?first("elo"):"all"};
}
export type AuctionVoucherSummary={issued:number;available:number;reserved:number;used:number;review:number;clients:number;vouchers:number};
export type AdminAuctionVoucher={id:string;customer_id:string;customer_name:string|null;phone_e164:string;title:string;campaign_title:string;campaign_id:string|null;amount:number;remaining:number;reserved:number;used:number;status:string;created_at:string};
export type AdminVoucherReport={summary:AuctionVoucherSummary;total:number;page:number;items:AdminAuctionVoucher[]};
export type AdminVoucherDetail={voucher:AdminAuctionVoucher;page:number;total:number;movements_total:number;lots_total:number;
 movements:{id:string;lot_id:string;delta:number;created_at:string;lot_code:string|null}[];
 lots:{id:string;code:string;title:string;status:string;arremate_value:number;voucher_amount:number;created_at:string}[]};
export type AdminRanking={page:number;total:number;customers:number;public_enabled:boolean;tiers:Record<string,number>;
 items:{id:string;name:string|null;phone_e164:string;rank_visible:boolean;points:number;position:number;tier_key:string}[]};
