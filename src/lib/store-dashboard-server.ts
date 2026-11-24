import "server-only";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import type { DashboardPeriod,StoreDashboardData } from "./store-dashboard";

export async function getStoreDashboard(period: DashboardPeriod) {
  await requireAdmin();
  const db=await createClient();
  const {data,error}=await db.rpc("get_store_dashboard_period",{p_start:period.startUtc,p_end:period.endUtc});
  return {data:data as StoreDashboardData|null,error:error ? error.code==='PGRST202' ? 'migration' : 'unavailable' : null};
}
