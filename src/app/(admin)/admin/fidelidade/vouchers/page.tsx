import Link from "next/link";
import {requireAdmin} from "@/lib/dal";
import {createClient} from "@/lib/supabase/server";
import {AdminVouchers} from "@/components/admin/loyalty/vouchers";
import {LoyaltyAdminShell} from "@/components/admin/loyalty/loyalty-admin-shell";
import type {CustomerVoucher,VoucherTemplate} from "@/lib/store-vouchers";
export const metadata={title:"Vouchers da loja"};
export const instant=false;
export default async function VouchersPage({searchParams}:{searchParams:Promise<{page?:string}>}){
 const {profile}=await requireAdmin();const params=await searchParams;const page=Math.max(1,Math.min(100000,Math.trunc(Number(params.page))||1));const db=await createClient();
 const [templates,issued,products]=await Promise.all([
  db.from('store_voucher_templates').select('*',{count:'exact'}).order('created_at',{ascending:false}).range((page-1)*20,page*20-1),
  db.from('customer_store_vouchers').select('*,customer:customers(name)',{count:'exact'}).order('created_at',{ascending:false}).range((page-1)*20,page*20-1),
  db.from('loyalty_rewards').select('id,name').gt('cash_price',0).is('points_cost',null).is('mixed_cash_price',null).order('name').limit(200),
 ]);
 return <LoyaltyAdminShell active="vouchers">{templates.error||issued.error||products.error?<p role="alert" className="rounded-xl border p-5">Não foi possível carregar os vouchers. Confira a migration 0037 antes de usar esta seção.</p>:<><AdminVouchers templates={templates.data as VoucherTemplate[]} issued={issued.data as CustomerVoucher[]} products={products.data} canEdit={profile.role!=='viewer'}/><nav aria-label="Paginação de vouchers" className="flex justify-between text-sm">{page>1?<Link href={`?page=${page-1}`} className="underline">Anterior</Link>:<span/>}<span>Página {page}</span>{Math.max(templates.count??0,issued.count??0)>page*20?<Link href={`?page=${page+1}`} className="underline">Próxima</Link>:<span/>}</nav></>}</LoyaltyAdminShell>;
}
