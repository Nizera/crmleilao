import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { RaffleBuyerBonusAdmin, type BuyerBonus } from "./raffle-buyer-bonus";
import { raffleMoney } from "@/lib/raffles";

export async function RaffleBuyerBonusPanel({ campaign, status }: { campaign: string; status: string }) {
  const { profile } = await requireAdmin();
  const db = await createClient();
  const [bonus, result, buyers] = await Promise.all([
    db.from("raffle_buyer_bonus").select("placement,title,delivery_kind,amount,version").eq("campaign_id", campaign).order("placement"),
    db.from("raffle_buyer_results").select("placement,title,quantity,status,delivery_kind,amount,fulfillment_note,pix_paid_at,customer:customers(name)").eq("campaign_id", campaign).order("placement"),
    db.rpc("get_admin_raffle_buyer_ranking", { p_campaign: campaign }),
  ]);
  if (bonus.error || result.error || buyers.error) return <p role="alert" className="rf-panel text-sm">Não foi possível carregar o bônus do maior comprador. Confira a atualização do banco antes de encerrar esta campanha.</p>;
  const bonuses = bonus.data ?? [];
  const results = result.data ?? [];
  return <div className="grid gap-4">
    <p className="rf-caption">Configure até três prêmios. A apuração usa a quantidade de cotas pagas. Em empate, vence quem atingiu o total primeiro. Empate exato exige conferência.</p>
    {[1, 2, 3].map(placement => {
      const configured = bonuses.find(item => item.placement === placement);
      const row = results.find(item => item.placement === placement);
      const customer = row ? (Array.isArray(row.customer) ? row.customer[0] : row.customer) : null;
      const previousConfigured = placement === 1 || bonuses.some(item => item.placement === placement - 1);
      if (!configured && !previousConfigured) return null;
      if (!configured && placement > 1 && (profile.role === "viewer" || !["draft", "paused", "open"].includes(status))) return null;
      return <RaffleBuyerBonusAdmin key={JSON.stringify([placement, configured, row])}
        campaign={campaign} placement={placement} status={status} owner={profile.role === "owner"}
        readonly={profile.role === "viewer" || results.length > 0 && !row}
        historical={placement === 1 && bonuses.length === 1}
        bonus={configured ?? null}
        result={row ? { ...row, winner: customer?.name ?? "Cliente cadastrado" } : null}
        buyers={placement === 1 ? buyers.data ?? [] : []} />;
    })}
  </div>;
}

type PrizePlacement = Pick<BuyerBonus, "placement" | "title" | "amount" | "delivery_kind">;

function prizeLabel(prize: PrizePlacement) {
  const amount = prize.amount ? (prize.delivery_kind === "physical_pix" ? " + Pix de " : " · ") + raffleMoney(Number(prize.amount)) : "";
  return prize.placement + "º maior comprador — " + prize.title + amount;
}

export async function RaffleBuyerBonusSummary({ campaign }: { campaign: string }) {
  await requireAdmin();
  const { data, error } = await (await createClient()).from("raffle_buyer_bonus")
    .select("placement,title,amount,delivery_kind").eq("campaign_id", campaign).order("placement");
  if (error) return <span>Não foi possível consultar os prêmios de maior comprador.</span>;
  return <span><strong>Maior comprador:</strong> {data?.length ? data.map(prizeLabel).join(" / ") : "Prêmio não configurado"}</span>;
}

export async function RaffleBuyerBonusNotice({ campaign }: { campaign: string }) {
  const { data, error } = await (await createClient()).rpc("get_raffle_buyer_placements", { p_campaign: campaign });
  if (error) return <p role="alert" className="rf-panel text-sm">Não foi possível conferir os prêmios de maior comprador agora. Confira o regulamento antes de participar.</p>;
  const prizes = (data ?? []) as PrizePlacement[];
  if (!prizes.length) return null;
  return <section className="rf-panel grid gap-2">
    <h2 className="rf-panel-title">Prêmios de maior comprador</h2>
    <ul>{prizes.map(prize => <li key={prize.placement} className="font-semibold">{prizeLabel(prize)}</li>)}</ul>
    <p className="rf-caption">Maior quantidade de cotas pagas. Em empate, vence quem atingiu o total primeiro com pagamentos confirmados.</p>
  </section>;
}

export async function MyBuyerBonuses() {
  const { data, error } = await (await createClient()).rpc("get_my_raffle_buyer_bonuses");
  if (error) return <p role="alert" className="rf-panel text-sm">Não foi possível consultar os bônus de maior comprador.</p>;
  const rows = (data ?? []) as { campaign_id: string; placement: number; campaign_title: string; title: string; delivery_kind: string; amount: number | null; quantity: number; status: string; has_logistics: boolean; pix_paid_at?:string|null; voucher_issued?:boolean; voucher_available?:number }[];
  return <>{rows.filter(row => !row.has_logistics || row.delivery_kind === "physical_pix").map(row => <article key={row.campaign_id + ":" + row.placement} className="rf-panel grid gap-2"><span className="rf-badge rf-badge-gold w-fit">{row.placement}º maior comprador · {row.quantity} cotas pagas</span><h2 className="font-semibold">{row.title}{row.amount ? `${row.delivery_kind === "physical_pix" ? " + Pix de " : " · "}${raffleMoney(row.amount)}` : ""}</h2><p className="rf-caption">{row.campaign_title}</p><p className="text-sm">{row.status === "review" ? "Em conferência pela equipe" : row.delivery_kind === "physical_pix" ? `Produto disponível em Meus prêmios. Pix adicional: ${row.pix_paid_at ? "pagamento confirmado" : "aguardando pagamento pela equipe"}.` : row.voucher_issued ? `Crédito disponível para lotes: ${raffleMoney(row.voucher_available??0)}. Peça à equipe para aplicar no cadastro do seu arremate.` : row.status === "fulfilled" ? "Entrega / pagamento confirmado" : "Aguardando entrega do voucher ou pagamento pela equipe"}</p></article>)}</>;
}
