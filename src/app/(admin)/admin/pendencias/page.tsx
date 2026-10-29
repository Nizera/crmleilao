import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { LOGISTICS_STATES, type LogisticsPending } from "@/lib/logistics-pending";
import { LogisticsPendingView } from "@/components/admin/logistics-pending-view";
import { getAppSettings } from "@/lib/dal";
import { nextShippingDate } from "@/lib/lots";
import { spToday } from "@/lib/dates";

export const metadata = { title: "Pendências logísticas" };
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] ?? "" : value ?? "";

export default async function LogisticsPendingPage({ searchParams }: PageProps<"/admin/pendencias">) {
  const { profile } = await requireAdmin();
  const params = await searchParams;
  const q = first(params.q).trim().slice(0, 80);
  const raw = first(params.status) || "active";
  const status = ["active", "all", ...Object.keys(LOGISTICS_STATES)].includes(raw) ? raw : "active";
  const page = Math.min(100000, Math.max(1, Math.floor(Number(first(params.p)) || 1)));
  const db = await createClient();
  let query = db.from("logistics_pending_list").select("id,code,customer_id,customer_name,phone_e164,title,quantity,reason,shipping_date,moved_at,shipment_id,shipment_code,tracking_code,state,created_at", { count: "exact" });
  if (status === "active") query = query.in("state", ["open", "boxed", "shipping", "shipped"]);
  else if (status !== "all") query = query.eq("state", status);
  const safe = q.replace(/[^\p{L}\p{N}\s+_-]/gu, " ").trim();
  if (safe) query = query.or(`code.ilike.%${safe}%,title.ilike.%${safe}%,customer_name.ilike.%${safe}%,phone_e164.ilike.%${safe}%`);
  const [{ data, count, error }, { settings }] = await Promise.all([
    query.order("shipping_date").order("created_at", { ascending: false }).order("id").range((page - 1) * 25, page * 25 - 1),
    getAppSettings(),
  ]);
  const missingMigration = error?.code === "42P01" || error?.code === "PGRST205";
  if (error && !missingMigration) throw new Error("Não foi possível carregar as pendências logísticas.");
  return <LogisticsPendingView key={`${q}/${status}/${page}`} rows={(data ?? []) as LogisticsPending[]} total={count ?? 0} page={page} q={q} status={status}
    canWrite={profile.role !== "viewer" && !error} migrationMissing={Boolean(missingMigration)} defaultDate={nextShippingDate(spToday(), settings.shipping_weekday)} />;
}
