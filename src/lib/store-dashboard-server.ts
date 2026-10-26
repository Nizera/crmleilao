import "server-only";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import type { DashboardPeriod,StoreDashboardData } from "./store-dashboard";

export async function getStoreDashboard(period: DashboardPeriod) {
  await requireAdmin();
  const db=await createClient();
  const {data,error}=await db.rpc("get_store_dashboard",{p_from:period.from,p_to:period.to});
  return {data:data as StoreDashboardData|null,error:error ? error.code==='PGRST202' ? 'migration' : 'unavailable' : null};
}
