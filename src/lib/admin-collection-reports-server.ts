import "server-only";
import {createClient} from "@/lib/supabase/server";
import type {AdminRanking,AdminVoucherDetail,AdminVoucherReport,AuctionVoucherSummary} from "@/lib/admin-collection-reports";
// Each RPC independently requires a signed-in staff profile; no public leaderboard is expanded.
async function read<T>(name:string,args:Record<string,unknown>={}):Promise<T>{
 const {data,error}=await (await createClient()).rpc(name,args);
 if(error)throw new Error("Não foi possível carregar o relatório administrativo.");
 return data as T;
}
export const getAdminVoucherSummary=()=>read<AuctionVoucherSummary>("get_admin_auction_voucher_summary");
export const getAdminVouchers=(query:string,status:string,page:number)=>read<AdminVoucherReport>("get_admin_auction_vouchers",{p_query:query,p_status:status,p_page:page});
export const getAdminVoucherDetail=(id:string,page:number)=>read<AdminVoucherDetail|null>("get_admin_auction_voucher_detail",{p_voucher:id,p_page:page});
export const getAdminRanking=(query:string,tier:string,page:number)=>read<AdminRanking>("get_admin_loyalty_ranking",{p_query:query,p_tier:tier,p_page:page});
