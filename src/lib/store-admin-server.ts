import "server-only";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AdminProduct, CatalogData, CatalogStatus } from "@/lib/store-admin";

export type CatalogFilters = { q: string; status: CatalogStatus; category: string; payment: string; page: number };
export function catalogFilters(params: Record<string,string | string[] | undefined>): CatalogFilters {
  const one = (key: string) => (Array.isArray(params[key]) ? params[key]?.[0] : params[key]) ?? "";
  const status=one("status"); const payment=one("payment");
  return {q:one("q").trim().slice(0,100),status:(["all","published","draft","sold-out","low-stock","archived","missing-photo","missing-cost"].includes(status)?status:"all") as CatalogStatus,
    category:one("category").slice(0,60),payment:["cash","coins","mixed"].includes(payment)?payment:"",page:Math.max(1,Math.min(100000,Math.trunc(Number(one("page"))) || 1))};
}
export async function getStoreCatalog(filters: CatalogFilters) {
  await requireAdmin();
  const db=await createClient();
  const {data,error}=await db.rpc("get_store_catalog",{p_query:filters.q,p_status:filters.status,p_category:filters.category,p_payment:filters.payment,p_page:filters.page});
  return {data:data as CatalogData | null,error:error ? "Aplique as migrations 0024 e 0025 para liberar o novo catálogo." : null};
}
export async function getProductEditorData(id?: string) {
  await requireAdmin();
  const db=await createClient(); const admin=createAdminClient();
  const [catalog,reservations,product]=await Promise.all([
    db.rpc("get_store_catalog",{p_page:1}),
    id ? db.rpc("get_store_reserved_quantities") : Promise.resolve({data:[],error:null}),
    id ? admin.from("loyalty_rewards").select("*").eq("id",id).maybeSingle() : Promise.resolve({data:null,error:null}),
  ]);
  const reserved=(reservations.data ?? []).find((row:{reward_id:string})=>row.reward_id===id)?.quantity ?? 0;
  return {product:product.data ? {...product.data,reserved:Number(reserved)} as AdminProduct : null,
    categories:(catalog.data as CatalogData | null)?.categories ?? [],ready:!catalog.error && !reservations.error && !product.error};
}
