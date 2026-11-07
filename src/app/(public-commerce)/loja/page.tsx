import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirectCommerceMember } from "@/lib/public-commerce-server";
import { PublicStorefront } from "@/components/client/public-storefront";
import { HistoryPagination } from "@/components/shared/history-pagination";
import { catalogFiltersFrom, type StoreBanner } from "@/lib/store-presentation";
import { historyFilters, pageHref } from "@/lib/loyalty-history";
import type { CustomerCatalog } from "@/lib/loyalty-history";
import { commerceLoginHref } from "@/lib/commerce-access";
import { redirect } from "next/navigation";
export const metadata={title:"Loja dos Caras · Colecionáveis"};export const instant=false;
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const params=await searchParams;await redirectCommerceMember(pageHref('/painel/loja',params,historyFilters(params).page));
 const filters=catalogFiltersFrom(params), page=historyFilters(params).page;const db=await createClient();
 const [result,banner]=await Promise.all([db.rpc('get_public_store_catalog',{p_query:filters.q,p_category:filters.category,p_mode:filters.mode,p_sort:filters.sort,p_page:page,p_min:filters.min?Number(filters.min):null,p_max:filters.max?Number(filters.max):null,p_available:filters.available}),createAdminClient().from('store_banner').select('active,title,subtitle,button_label,button_href,desktop_path,mobile_path').eq('id',true).eq('active',true).maybeSingle()]);
 if(result.error)return <p role="alert" className="rounded-xl border p-5">Não foi possível carregar a loja agora. Tente novamente em instantes.</p>;
 const catalog=result.data as CustomerCatalog;if(catalog.page!==page)redirect(pageHref('/loja',params,catalog.page));
 return <div className="store-page grid min-w-0 gap-5"><header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">Loja dos Caras</h1><p className="mt-1 text-sm text-muted-foreground">Explore a coleção. Faça login apenas para comprar.</p></div><Link className="text-sm underline" href={commerceLoginHref('/painel/loja?tab=vouchers')}>Vouchers e meus pedidos</Link></header><PublicStorefront catalog={catalog} filters={filters} banner={banner.error||!banner.data?{active:false}:banner.data as StoreBanner}/><HistoryPagination path="/loja" params={params} data={catalog}/></div>;
}
