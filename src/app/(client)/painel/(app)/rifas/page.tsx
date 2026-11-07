import { readPrizeImages } from "@/lib/raffle-prize-images-server";
import Link from "next/link";
import { Gift, Search, Ticket } from "lucide-react";
import { requireCustomer } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { RaffleCard, RaffleUnavailable } from "@/components/raffles/raffle-shared";
import { RaffleOrdersList } from "@/components/raffles/raffle-client";
import type { Raffle, RaffleOrder, RaffleAward } from "@/lib/raffles";
import { rafflePhotos } from "@/lib/raffle-photos";
import { readRafflePresentation } from "@/lib/raffle-presentation-server";
import { RaffleAwardCard } from "@/components/raffles/raffle-award-card";
import { RaffleEmpty, RafflePagination } from "@/components/raffles/raffle-ui";
export const metadata = { title: "Rifas dos Caras" };
export const instant = false;
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { customer } = await requireCustomer(); const params = await searchParams;
  const tab = ["orders", "awards"].includes(String(params.tab)) ? String(params.tab) : "participate";
  const page = Math.min(10000, Math.max(1, Math.trunc(Number(params.page) || 1)));
  const q = String(params.q ?? "").trim().slice(0, 100);
  const ended = params.state === "closed";
  const db = await createClient(); let content: React.ReactNode; let total: number | undefined; let more = false;
  const media = async (awards: RaffleAward[]) => {
    const photos = new Map<string, string[]>();
    if (awards.length) {
      const images = await db.from("raffle_campaigns").select("id,image_url,image_urls").in("id", [...new Set(awards.map(a => a.campaign_id))]);
      for (const campaign of images.data ?? []) photos.set(campaign.id, rafflePhotos(campaign));
    }
    const prizePhotos = await readPrizeImages([], awards.map(a => a.id));
    for (const award of awards) photos.set(award.id, prizePhotos.get(award.id)?.length ? prizePhotos.get(award.id)! : photos.get(award.campaign_id) ?? []);
    return photos;
  };
  if (tab === "participate") {
    let query = db.from("raffle_campaigns").select("*", { count: "exact" }).in("status", ended ? ["closed"] : ["open", "paused"]).is("archived_at", null);
    if (q) query = query.ilike("title", `%${q.replace(/[%_]/g, "")}%`);
    const result = await query.order("created_at", { ascending: false }).order("id").range((page - 1) * 10, page * 10 - 1);
    total = result.count ?? 0; more = page * 10 < total;
    let summary: Awaited<ReturnType<typeof readRafflePresentation>> | null = null;
    if (!result.error) { try { summary = await readRafflePresentation((result.data ?? []).map(c => c.id)); } catch { /* Os cards continuam disponíveis sem indicadores parciais. */ } }
    content = <><form className="rf-search" action="/painel/rifas"><Search size={17} className="shrink-0 text-muted-foreground" /><input aria-label="Buscar campanha" name="q" placeholder="Buscar campanha" defaultValue={q} maxLength={100} /><input type="hidden" name="state" value={ended ? "closed" : "active"} /><button className="text-xs font-semibold text-ouro-ink" type="submit">Buscar</button></form>
      <div className="flex flex-wrap gap-2"><Link className="rf-chip" aria-current={!ended ? "page" : undefined} href={`?q=${encodeURIComponent(q)}`}>Em andamento</Link><Link className="rf-chip" aria-current={ended ? "page" : undefined} href={`?state=closed&q=${encodeURIComponent(q)}`}>Encerradas</Link></div>
      {result.error ? <RaffleUnavailable /> : result.data?.length ? <div className="grid items-start gap-5 sm:grid-cols-2 lg:grid-cols-3">{(result.data as Raffle[]).map(c => <RaffleCard key={c.id} campaign={c} summary={summary?.complete ? summary.summaries[c.id] ?? { paid: 0, reserved: 0, received: 0, instantPrizes: 0 } : undefined} />)}</div> : <RaffleEmpty title={q ? "Nenhuma campanha encontrada" : ended ? "Ainda não há campanhas encerradas" : "Novas rifas estão chegando"} description={q ? "Tente outro nome ou limpe a busca para ver as campanhas." : "Suas participações e prêmios continuam disponíveis nas outras abas."} />}</>;
  } else if (tab === "awards") {
    const result = await db.rpc("get_raffle_awards", { p_page: page }); const won = (result.data ?? []) as RaffleAward[]; more = won.length === 20;
    const photos = await media(won);
    content = result.error ? <RaffleUnavailable /> : won.length ? <><div className="flex items-center gap-2 text-sm text-muted-foreground"><Gift size={16} className="text-ouro-ink" />Suas conquistas, da confirmação até a entrega.</div><div className="rf-award-grid grid gap-4">{won.map(a => <RaffleAwardCard key={a.id} award={a} images={photos.get(a.id) ?? []} />)}</div></> : <RaffleEmpty title="Suas próximas conquistas ficam aqui" description="Prêmios principais e cotas premiadas aparecem com fotos e acompanhamento da entrega." href="/painel/rifas" action="Conhecer as campanhas" />;
  } else {
    const result = await db.from("raffle_orders").select("*,campaign:raffle_campaigns(title,total_numbers)", { count: "exact" }).eq("customer_id", customer.id).order("created_at", { ascending: false }).order("id").range((page - 1) * 10, page * 10 - 1);
    total = result.count ?? 0; more = page * 10 < total;
    const won = result.error ? { data: [], error: result.error } : await db.rpc("get_raffle_awards", { p_orders: (result.data ?? []).map(o => o.id) });
    const photos = await media((won.data ?? []) as RaffleAward[]);
    content = result.error || won.error ? <RaffleUnavailable /> : result.data?.length ? <RaffleOrdersList orders={result.data.map(o => ({ ...o, campaign_title: o.campaign?.title, total_numbers: o.campaign?.total_numbers } as RaffleOrder))} awards={(won.data ?? []).map((a: RaffleAward) => ({ ...a, photos: photos.get(a.id) ?? [] }))} /> : <RaffleEmpty title="Você ainda não tem cotas" description="Escolha uma campanha e acompanhe o Pix, seus números e os resultados por aqui." href="/painel/rifas" action="Escolher uma campanha" />;
  }
  return <div className="grid min-w-0 gap-5"><header className="rf-heading"><div><h1>{tab === "awards" ? "Meus prêmios" : tab === "orders" ? "Minhas cotas" : "Rifas dos Caras"}</h1><p>{tab === "participate" ? "Sua próxima peça de coleção está aqui." : tab === "orders" ? "Seus números, pagamentos e resultados em um só lugar." : "Cada conquista merece um lugar na sua coleção."}</p></div><span className="rf-icon-tile"><Ticket size={22} /></span></header><nav aria-label="Seções de rifas" className="rf-tabs rf-client-tabs">{[["participate", "Participar"], ["orders", "Minhas cotas"], ["awards", "Meus prêmios"]].map(([key, label]) => <Link key={key} href={`?tab=${key}`} aria-current={tab === key ? "page" : undefined}>{label}</Link>)}</nav>{content}<RafflePagination page={page} more={more} count={total} href={p => `?${new URLSearchParams({ tab, q, state: ended ? "closed" : "active", page: String(p) })}`} /></div>;
}
