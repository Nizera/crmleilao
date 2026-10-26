import "server-only";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import type { OrderHistoryData, OrderHistoryFilters } from "./order-history";

export async function getAdminOrderHistory(filters: OrderHistoryFilters) {
  await requireAdmin();
  const db = await createClient();
  const { data,error } = await db.rpc("get_admin_order_history",{
    p_query:filters.q,p_status:filters.status,p_source:filters.source,p_from:filters.from || null,p_to:filters.to || null,
    p_page:filters.page,p_size:filters.size,
  });
  return { data: data as OrderHistoryData | null, error: error ? (error.code === "PGRST202" ? "migration" : "unavailable") : null };
}
