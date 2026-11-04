import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { summarizeRaffleCampaigns, type RaffleSummaryOrder } from "@/lib/raffle-presentation";

/** Chamado apenas depois do guard da página. Retorna ao cliente somente contagens, nunca cotas ou compradores. */
export async function readRafflePresentation(campaignIds?: string[]) {
  if (campaignIds && !campaignIds.length) return { orders: [], summaries: {}, complete: true };
  if (campaignIds && campaignIds.length > 100) throw new Error("Limite de campanhas por consulta.");
  const db = createAdminClient();
  const orders: RaffleSummaryOrder[] = [];
  let complete = true;
  for (let page = 0; page < 6; page++) {
    let query = db.from("raffle_orders").select("campaign_id,status,amount,numbers,created_at,paid_at").order("created_at", { ascending: false }).order("id");
    if (campaignIds) query = query.in("campaign_id", campaignIds);
    const { data, error } = await query.range(page * 1000, page * 1000 + 999);
    if (error) throw new Error("Não foi possível carregar os indicadores das rifas.");
    if (page === 5) { if (data?.length) complete = false; break; }
    orders.push(...(data ?? []) as RaffleSummaryOrder[]);
    if ((data?.length ?? 0) < 1000) break;
  }
  const ids = campaignIds ?? [...new Set(orders.map(o => o.campaign_id))].slice(0, 100);
  let prizes: { campaign_id: string; kind: string }[] = [];
  if (ids.length) {
    const { data, error, count } = await db.from("raffle_prizes").select("campaign_id,kind", { count: "exact" }).in("campaign_id", ids).eq("kind", "instant").limit(1000);
    if (error) throw new Error("Não foi possível conferir as cotas premiadas.");
    prizes = data ?? [];
    if ((count ?? 0) > 1000) complete = false;
  }
  return { orders, summaries: summarizeRaffleCampaigns(orders, prizes), complete };
}
