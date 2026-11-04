import Link from "next/link";
import { ArrowUpRight, Search } from "lucide-react";
import { z } from "zod";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RaffleAward } from "@/lib/raffles";
import { rafflePhotos } from "@/lib/raffle-photos";
import { RaffleUnavailable } from "@/components/raffles/raffle-shared";
import { RaffleAwardCard } from "@/components/raffles/raffle-award-card";
import { RaffleEmpty, RafflePagination } from "@/components/raffles/raffle-ui";
import { Button } from "@/components/ui/button";
export const metadata = { title: "Prêmios de rifas" };
export const instant = false;
type AwardRow = { id: string; campaign_id: string; order_id: string; customer_id: string; number: number; logistics_id: string; prize: { title: string; kind: string }; campaign: { title: string; total_numbers: number; image_url: string; image_urls?: string[] }; customer: { name: string }; order: { status: string }; logistics: { moved_at: string | null; shipment_id: string | null; cancelled_at: string | null; shipment: { status: string; tracking_code: string | null } | null } };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin(); const params = await searchParams;
  const page = Math.min(10000, Math.max(1, Math.trunc(Number(params.page) || 1)));
  const stage = ["unmoved", "boxed", "shipping", "delivered", "review"].includes(String(params.stage)) ? String(params.stage) : "all";
  const q = String(params.q ?? "").trim().slice(0, 100);
  const campaign = z.uuid().safeParse(params.campaign).success ? String(params.campaign) : "";
  const shipmentJoin = ["shipping", "delivered"].includes(stage) ? "shipments!inner" : "shipments";
  let query = createAdminClient().from("raffle_awards").select(`id,campaign_id,order_id,customer_id,number,logistics_id,prize:raffle_prizes!inner(title,kind),campaign:raffle_campaigns!inner(title,total_numbers,image_url,image_urls),customer:customers!inner(name),order:raffle_orders!inner(status),logistics:logistics_pending!inner(moved_at,shipment_id,cancelled_at,shipment:${shipmentJoin}(status,tracking_code))`, { count: "exact" });
  if (campaign) query = query.eq("campaign_id", campaign);
  if (q) query = query.ilike("customer.name", `%${q.replace(/[%_]/g, "")}%`);
  if (stage === "review") query = query.eq("order.status", "review");
  else if (stage !== "all") {
    query = query.eq("order.status", "paid").is("logistics.cancelled_at", null);
    if (stage === "unmoved") query = query.is("logistics.moved_at", null).is("logistics.shipment_id", null);
    if (stage === "boxed") query = query.not("logistics.moved_at", "is", null).is("logistics.shipment_id", null);
    if (stage === "shipping") query = query.not("logistics.shipment.status", "in", "(cancelled,delivered)");
    if (stage === "delivered") query = query.eq("logistics.shipment.status", "delivered");
  }
  const [result, campaigns] = await Promise.all([query.order("created_at", { ascending: false }).order("id").range((page - 1) * 20, page * 20 - 1), (await createClient()).from("raffle_campaigns").select("id,title").order("created_at", { ascending: false }).limit(100)]);
  const href = (p: number, next = stage) => `?${new URLSearchParams({ page: String(p), stage: next, q, campaign })}`;
  const rows = (result.data ?? []) as unknown as AwardRow[];
  return <main className="grid min-w-0 gap-5 p-4 md:p-8"><header className="rf-heading"><div><p className="rf-eyebrow mb-2">RIFA / PRÊMIOS E SEPARAÇÃO</p><h1>Cada conquista, uma entrega</h1><p>Acompanhe os ganhadores, a separação e o envio dos prêmios.</p></div><Link className="rf-button rf-button-primary" href="/admin/relatorios">Abrir separação<ArrowUpRight size={16} /></Link></header>
    <div className="rf-panel grid gap-4"><nav className="rf-tabs" aria-label="Situação dos prêmios">{[["all", "Todos"], ["unmoved", "A separar"], ["boxed", "Na caixa"], ["shipping", "Com envio"], ["delivered", "Entregues"], ["review", "Em análise"]].map(([key, label]) => <Link key={key} href={href(1, key)} aria-current={stage === key ? "page" : undefined}>{label}</Link>)}</nav><form className="grid items-end gap-3 md:grid-cols-[1fr_1fr_auto]"><label className="grid min-w-0 gap-2 text-xs font-semibold text-muted-foreground">Campanha<select name="campaign" defaultValue={campaign} className="h-11 min-w-0 rounded-lg border bg-card px-3 text-sm text-foreground"><option value="">Todas as campanhas</option>{campaigns.data?.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label><label className="grid gap-2 text-xs font-semibold text-muted-foreground">Ganhador<span className="rf-search"><Search size={15} /><input name="q" defaultValue={q} placeholder="Buscar pelo nome do cliente" maxLength={100} /></span></label><input type="hidden" name="stage" value={stage} /><div className="flex items-center gap-3"><Button>Filtrar</Button>{(q || campaign || stage !== "all") && <Link className="text-xs text-muted-foreground underline" href="/admin/rifa/premios">Limpar</Link>}</div></form></div>
    {result.error || campaigns.error ? <RaffleUnavailable /> : <><p className="rf-caption">{result.count ?? 0} prêmios encontrados. A movimentação para a caixa é feita no relatório de separação.</p>{rows.length ? <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">{rows.map(row => { const award: RaffleAward & { customer_name: string } = { id: row.id, campaign_id: row.campaign_id, order_id: row.order_id, customer_id: row.customer_id, number: row.number, logistics_id: row.logistics_id, title: row.prize.title, kind: row.prize.kind, campaign_title: row.campaign.title, total_numbers: row.campaign.total_numbers, customer_name: row.customer.name, order_status: row.order.status, moved_at: row.logistics.moved_at, cancelled_at: row.logistics.cancelled_at, shipment_id: row.logistics.shipment_id, shipment_status: row.logistics.shipment?.status ?? null, tracking_code: row.logistics.shipment?.tracking_code ?? null }; return <RaffleAwardCard key={row.id} award={award} images={rafflePhotos(row.campaign)} admin />; })}</div> : <RaffleEmpty title="Nenhum prêmio neste filtro" description="Os prêmios aparecem aqui assim que uma cota premiada é confirmada ou um ganhador principal é registrado." />}
    <RafflePagination page={page} more={page * 20 < (result.count ?? 0)} count={result.count ?? 0} href={p => href(p)} /></>}
  </main>;
}
