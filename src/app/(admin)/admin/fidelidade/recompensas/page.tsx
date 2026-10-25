import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/dal";
import { catalogFilters,getStoreCatalog } from "@/lib/store-admin-server";
import { CATALOG_PATH } from "@/lib/store-admin";
import { ProductCatalog } from "@/components/admin/loyalty/product-catalog";
import { LoyaltyAdminShell } from "@/components/admin/loyalty/loyalty-admin-shell";

export const metadata={title:"Produtos da loja"};
export default async function StoreProductsPage({searchParams}:PageProps<"/admin/fidelidade/recompensas">) {
  const {profile}=await requireAdmin(); const params=await searchParams; const filters=catalogFilters(params);
  const {data,error}=await getStoreCatalog(filters);
  if(!data || error)return <LoyaltyAdminShell active="recompensas"><div className="rounded-xl border p-5"><p className="font-semibold">O novo catálogo precisa da atualização do banco</p><p className="mt-2 text-sm text-muted-foreground">{error}</p><code className="mt-3 block text-xs">0025_store_catalog_admin.sql</code></div></LoyaltyAdminShell>;
  const lastPage=Math.max(1,Math.ceil(data.total/25));
  if(filters.page>lastPage){const next=new URLSearchParams();if(filters.q)next.set("q",filters.q);if(filters.status!=="all")next.set("status",filters.status);if(filters.category)next.set("category",filters.category);if(filters.payment)next.set("payment",filters.payment);if(lastPage>1)next.set("page",String(lastPage));redirect(`${CATALOG_PATH}${next.size?`?${next}`:""}`);}
  return <LoyaltyAdminShell active="recompensas" hideHeader saved={params.salvo==="1"}><ProductCatalog key={JSON.stringify(filters)} data={data} filters={filters} canEdit={profile.role!=="viewer"} /></LoyaltyAdminShell>;
}
