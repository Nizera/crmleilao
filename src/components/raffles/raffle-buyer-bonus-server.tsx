import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { RaffleBuyerBonusAdmin, type BuyerBonus } from "./raffle-buyer-bonus";
import { raffleMoney } from "@/lib/raffles";

export async function RaffleBuyerBonusPanel({ campaign, status }: { campaign: string; status: string }) {
  const { profile } = await requireAdmin();
  const db = await createClient();
  const [bonus, result, buyers] = await Promise.all([
    db.from("raffle_buyer_bonus").select("title,delivery_kind,amount,version").eq("campaign_id", campaign).maybeSingle(),
    db.from("raffle_buyer_results").select("title,quantity,status,delivery_kind,amount,fulfillment_note,customer:customers(name)").eq("campaign_id", campaign).maybeSingle(),
    db.rpc("get_admin_raffle_buyer_ranking", { p_campaign: campaign }),
  ]);
  if (bonus.error || result.error || buyers.error) return <p role="alert" className="rf-panel text-sm">Não foi possível carregar o bônus do maior comprador. Confira a atualização do banco antes de encerrar esta campanha.</p>;
  const row = result.data;
  const customer = row ? (Array.isArray(row.customer) ? row.customer[0] : row.customer) : null;
  return <RaffleBuyerBonusAdmin key={JSON.stringify([bonus.data, row])} campaign={campaign} status={status} owner={profile.role === "owner"} readonly={profile.role === "viewer"} bonus={bonus.data as BuyerBonus | null} result={row ? { ...row, winner: customer?.name ?? "Cliente cadastrado" } : null} buyers={buyers.data ?? []} />;
}

export async function RaffleBuyerBonusSummary({ campaign }: { campaign: string }) {
  await requireAdmin();
  const { data, error } = await (await createClient()).from("raffle_buyer_bonus")
    .select("title,amount").eq("campaign_id", campaign).maybeSingle();
  if (error) return <span>Não foi possível consultar o prêmio do maior comprador.</span>;
  return <span><strong>Maior comprador:</strong> {data ? <>{data.title}{data.amount ? ` · ${raffleMoney(Number(data.amount))}` : ""}</> : "Prêmio não configurado"}</span>;
}

export async function RaffleBuyerBonusNotice({ campaign }: { campaign: string }) {
  const { data, error } = await (await createClient()).rpc("get_raffle_buyer_bonus", { p_campaign: campaign });
  if (error) return <p role="alert" className="rf-panel text-sm">Não foi possível conferir o bônus de maior comprador agora. Confira o regulamento antes de participar.</p>;
  if (!data) return null;
  return <section className="rf-panel grid gap-2"><h2 className="rf-panel-title">Prêmio do maior comprador</h2><p className="font-semibold">{data.title}{data.amount ? ` · ${raffleMoney(data.amount)}` : ""}</p><p className="rf-caption">{data.rule}</p></section>;
}

export async function MyBuyerBonuses() {
  const { data, error } = await (await createClient()).rpc("get_my_raffle_buyer_bonuses");
  if (error) return <p role="alert" className="rf-panel text-sm">Não foi possível consultar os bônus de maior comprador.</p>;
  const rows = (data ?? []) as { campaign_id: string; campaign_title: string; title: string; delivery_kind: string; amount: number | null; quantity: number; status: string; has_logistics: boolean; voucher_issued?:boolean; voucher_available?:number }[];
  return <>{rows.filter(row => !row.has_logistics).map(row => <article key={row.campaign_id} className="rf-panel grid gap-2"><span className="rf-badge rf-badge-gold w-fit">Maior comprador · {row.quantity} cotas pagas</span><h2 className="font-semibold">{row.title}{row.amount ? ` · ${raffleMoney(row.amount)}` : ""}</h2><p className="rf-caption">{row.campaign_title}</p><p className="text-sm">{row.status === "review" ? "Em conferência pela equipe" : row.voucher_issued ? `Crédito disponível para lotes: ${raffleMoney(row.voucher_available??0)}. Peça à equipe para aplicar no cadastro do seu arremate.` : row.status === "fulfilled" ? "Entrega / pagamento confirmado" : "Aguardando entrega do voucher ou pagamento pela equipe"}</p></article>)}</>;
}
