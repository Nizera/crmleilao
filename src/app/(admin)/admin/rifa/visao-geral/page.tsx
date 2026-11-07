import { dashboardCampaignSelection, raffleDashboardOrders } from "@/lib/raffle-dashboard-filters";
import { RaffleCampaignFilter } from "@/components/raffles/raffle-campaign-filter";
import { raffleNetRevenue } from "@/lib/raffle-presentation";
import Link from "next/link";
import { ArrowRight, Clock3, Coins, Gift, Plus, Ticket, Trophy } from "lucide-react";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readRafflePresentation } from "@/lib/raffle-presentation-server";
import { raffleMoney, type Raffle } from "@/lib/raffles";
import { RaffleMetric, RaffleEmpty, RaffleBadge, RaffleProgress } from "@/components/raffles/raffle-ui";
import { RaffleUnavailable } from "@/components/raffles/raffle-shared";
export const metadata = { title: "Rifas · Visão geral" };
export const instant = false;
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { profile } = await requireAdmin(); const params = await searchParams;
  const days = params.days === "all" ? "all" : [7,30,90].includes(Number(params.days)) ? Number(params.days) : 30;
  const now = new Date(); const from = days === "all" ? "1970-01-01T00:00:00.000Z" : new Date(now.getTime() - days * 86400000).toISOString();
  const db = await createClient();
  const selection = dashboardCampaignSelection(params.campaign);
  const globalPresentation = readRafflePresentation().catch(() => null);
  let campaignsQuery=db.from("raffle_campaigns").select("*");
  campaignsQuery=selection.active?campaignsQuery.in("id",selection.ids):campaignsQuery.is("archived_at",null).in("status",["open","paused"]);
  let pausedQuery=db.from("raffle_campaigns").select("id",{count:"exact",head:true}).is("archived_at",null).eq("status","paused");
  let awardsQuery=createAdminClient().from("raffle_awards").select("id,logistics:logistics_pending!inner(moved_at,cancelled_at),order:raffle_orders!inner(status)",{count:"exact",head:true}).gte("created_at",from).lte("created_at",now.toISOString()).is("logistics.moved_at",null).is("logistics.cancelled_at",null).eq("order.status","paid");
  if(selection.active){pausedQuery=pausedQuery.in("id",selection.ids);awardsQuery=awardsQuery.in("campaign_id",selection.ids);}
  const [presentation,campaigns,paused,awards,allCampaigns,allPresentation]=await Promise.all([
    selection.active?readRafflePresentation(selection.ids).catch(()=>null):globalPresentation,
    campaignsQuery.order("created_at",{ascending:false}).limit(selection.active?100:6),
    pausedQuery,awardsQuery,
    db.from("raffle_campaigns").select("id,title,status,total_numbers,archived_at").order("created_at",{ascending:false}).limit(501),
    globalPresentation,
  ]);
  const options=(allCampaigns.data??[]).slice(0,500).map(c=>({id:c.id,title:c.title,status:c.status,total_numbers:c.total_numbers,archived:Boolean(c.archived_at),paid:allPresentation?.complete?(allPresentation.summaries[c.id]?.paid??0):null}));
  const filteredOrders=raffleDashboardOrders(presentation?.orders??[],selection.active?selection.ids:undefined);
  const usable = presentation?.complete;
  const received = filteredOrders.filter(o => o.status === "paid" && o.paid_at && o.paid_at >= from && o.paid_at <= now.toISOString()) ?? [];
  const pending = filteredOrders.filter(o => ["creating", "pending"].includes(o.status) && o.created_at >= from && o.created_at <= now.toISOString()) ?? [];
  const cash = received.reduce((sum, o) => sum + Math.round(Number(o.amount) * 100), 0) / 100;
  const revenue = raffleNetRevenue(cash);
  const quotas = received.reduce((sum, o) => sum + o.numbers.length, 0);
  const chartFrom=days === "all" ? new Date(Math.min(now.getTime(),...filteredOrders.flatMap(o=>[Date.parse(o.created_at),o.paid_at?Date.parse(o.paid_at):NaN]).filter(Number.isFinite))).toISOString() : from;
  const chartDays=days === "all" ? Math.max(1,(now.getTime()-Date.parse(chartFrom))/86400000) : days;
  const points = Array.from({ length: 7 }, (_, index) => {
    const start = new Date(Date.parse(chartFrom) + index * chartDays / 7 * 86400000);
    const end = new Date(Date.parse(chartFrom) + (index + 1) * chartDays / 7 * 86400000);
    return { label: start.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" }), cash: received.filter(o => o.paid_at! >= start.toISOString() && o.paid_at! < end.toISOString()).reduce((sum, o) => sum + Math.round(Number(o.amount) * 100), 0) / 100 };
  });
  const max = Math.max(1, ...points.map(p => p.cash));
  return <main className="grid min-w-0 gap-6 p-4 md:p-8">
    <header className="rf-heading"><div><p className="rf-eyebrow mb-2">RIFA / VISÃO GERAL</p><h1>Rifas</h1><p>Campanhas, pagamentos e prêmios em um só lugar.</p></div>{profile.role !== "viewer" && <Link href="/admin/rifa/nova" className="rf-button rf-button-primary"><Plus size={16} />Nova campanha</Link>}</header>
    <form id="raffle-dashboard-filters" className="grid items-start gap-4 rounded-2xl border bg-card p-4 md:grid-cols-[180px_minmax(0,1fr)_auto]" action="/admin/rifa/visao-geral"><label className="grid gap-2 text-xs font-medium text-muted-foreground">Período dos indicadores<select name="days" defaultValue={days} className="h-10 rounded-lg border bg-background px-3 text-sm text-foreground">{[7,30,90].map(d=><option key={d} value={d}>Últimos {d} dias</option>)}<option value="all">Todo o histórico</option></select></label><RaffleCampaignFilter key={selection.ids.join(',')+'/'+days} campaigns={options} selected={selection.ids} truncated={(allCampaigns.data?.length??0)>500}/><div className="flex items-center gap-3 md:pt-6"><button type="submit" className="rf-button rf-button-primary">Aplicar filtros</button>{selection.active&&<Link className="text-xs underline" href={`?days=${days}`}>Limpar</Link>}</div></form>
    <p className="rf-caption">{selection.active?`Indicadores de ${selection.ids.length} campanha(s) selecionada(s), considerando pagamentos no período acima.`:"Indicadores de todas as campanhas, considerando o período acima."}</p>
    {selection.invalid&&<p role="alert" className="text-sm text-destructive">Há campanhas inválidas ou além do limite de 100 na seleção. Revise os filtros.</p>}
    {allCampaigns.error&&<p role="alert" className="text-sm text-destructive">Não foi possível carregar a lista de campanhas. Atualize a página para selecionar.</p>}

    {!presentation || campaigns.error || paused.error || awards.error ? <RaffleUnavailable /> : <>
      {!usable && <p role="status" className="rounded-xl border border-ouro/30 bg-ouro/5 p-4 text-sm">O volume de registros ultrapassou o limite desta visão. Os totais foram ocultados para não mostrar indicadores parciais.</p>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><RaffleMetric label="Recebido líquido" value={usable ? raffleMoney(revenue.net) : "—"} hint={usable ? `Bruto: ${raffleMoney(revenue.gross)} · API 1%: ${raffleMoney(revenue.fee)}` : "Pagamentos confirmados no período"} icon={Coins} /><RaffleMetric label="Cotas pagas" value={usable ? quotas : "—"} hint="Cotas dos pagamentos do período" icon={Ticket} /><RaffleMetric label="Reservas em aberto" value={usable ? pending.length : "—"} hint="Criadas no período, ainda sem pagamento" icon={Clock3} /><RaffleMetric label="Prêmios a separar" value={awards.count ?? 0} hint="Conquistados no período" icon={Gift} /></div>
      <div className="grid items-start gap-4 xl:grid-cols-[1.6fr_1fr]"><section className="rf-panel"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="rf-panel-title">Pagamentos confirmados</h2><p className="rf-caption mt-1">Valores brutos por data de pagamento</p></div><span className="rf-badge rf-badge-gold">{usable ? raffleMoney(cash) : "—"}</span></div>{usable && cash > 0 ? <div className="mt-7 grid h-48 grid-cols-7 items-end gap-2 sm:gap-4" role="img" aria-label={`${days === "all" ? "Pagamentos de todo o histórico" : `Pagamentos nos últimos ${days} dias`}: ${raffleMoney(cash)}`}>{points.map((point, index) => <div key={index} className="flex h-full min-w-0 flex-col items-center justify-end gap-3"><div className="group relative flex w-full flex-1 items-end justify-center"><div title={`${point.label}: ${raffleMoney(point.cash)}`} className="w-full max-w-14 rounded-t-md bg-ouro/75 transition-colors hover:bg-ouro" style={{ height: `${Math.max(point.cash > 0 ? 3 : 0, point.cash / max * 100)}%` }} /><span className="pointer-events-none absolute bottom-full mb-1 rounded-md bg-foreground px-2 py-1 text-[10px] whitespace-nowrap text-background opacity-0 group-hover:opacity-100">{raffleMoney(point.cash)}</span></div><span className="text-[10px] text-muted-foreground">{point.label}</span></div>)}</div> : <div className="flex h-48 items-center justify-center text-center text-sm text-muted-foreground">{usable ? "Os pagamentos confirmados neste período aparecerão aqui." : "Indicadores indisponíveis."}</div>}</section>
        <section className="rf-panel grid gap-4"><h2 className="rf-panel-title">Precisa de atenção</h2><Link href="/admin/rifa?status=paused" className="flex items-center gap-3 rounded-xl border p-3"><span className="rf-icon-tile"><Trophy size={18} /></span><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{paused.count ?? 0} campanhas pausadas</p><p className="rf-caption">Confira pagamentos e apuração.</p></div><ArrowRight size={16} className="shrink-0 text-ouro-ink" /></Link><Link href="/admin/rifa/premios" className="flex items-center gap-3 rounded-xl border p-3"><span className="rf-icon-tile"><Gift size={18} /></span><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{awards.count ?? 0} prêmios a separar</p><p className="rf-caption">Ganhadores do período selecionado.</p></div><ArrowRight size={16} className="shrink-0 text-ouro-ink" /></Link><div className="flex items-start gap-3 rounded-xl bg-muted p-3"><Clock3 size={18} className="mt-0.5 shrink-0 text-ouro-ink" /><div><p className="text-sm font-semibold">Reserva por 10 minutos</p><p className="rf-caption mt-1">Cotas são liberadas após a confirmação do cancelamento do Pix.</p></div></div></section>
      </div>
      <section className="rf-panel grid gap-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="rf-panel-title">{selection.active?"Campanhas selecionadas":"Campanhas ativas"}</h2><p className="rf-caption mt-1">Situação atual · valores acumulados da campanha</p></div><Link className="flex items-center gap-1 text-xs font-semibold text-ouro-ink" href="/admin/rifa">Ver todas<ArrowRight size={14} /></Link></div>{campaigns.data?.length ? <div className="rf-table-wrap"><table className="rf-table"><thead><tr><th>Campanha</th><th>Situação</th><th>Cotas pagas</th><th>Ação</th></tr></thead><tbody>{(campaigns.data as Raffle[]).map(c => { const summary = usable ? presentation.summaries[c.id] : null; const ready = !c.archived_at && c.status === "paused" && summary && summary.paid >= c.total_numbers; return <tr key={c.id}><td><Link href={`/admin/rifa/${c.id}`} className="flex min-w-0 items-center gap-3">{c.image_url && <picture><img src={c.image_url} alt="" className="rf-small-photo" loading="lazy" referrerPolicy="no-referrer" /></picture>}<div className="min-w-0"><span className="rf-table-title">{c.title}</span><span className="rf-caption">{raffleMoney(c.unit_price)} por cota</span></div></Link></td><td data-label="Situação"><RaffleBadge status={c.status}>{c.archived_at ? "Arquivada" : ready ? "Pronta para apuração" : undefined}</RaffleBadge></td><td data-label="Cotas pagas">{summary ? <div className="max-w-40"><strong className="mb-2 block">{summary.paid}/{c.total_numbers}</strong><RaffleProgress paid={summary.paid} reserved={summary.reserved} total={c.total_numbers} /></div> : "—"}</td><td data-label="Ação"><Link className={`rf-button ${ready ? "rf-button-primary" : ""}`} href={`/admin/rifa/${c.id}${ready ? "?tab=result" : ""}`}>{ready ? "Apurar" : "Gerenciar"}<ArrowRight size={14} /></Link></td></tr>; })}</tbody></table></div> : <RaffleEmpty title="Tudo em dia por aqui" description="Suas próximas campanhas ativas aparecerão nesta área." href="/admin/rifa" action="Ver campanhas" />}</section>
    </>}
  </main>;
}
