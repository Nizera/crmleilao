import Link from "next/link";
import { Gift, Ticket } from "lucide-react";
import { requireCustomer } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { RaffleCard, RaffleUnavailable } from "@/components/raffles/raffle-shared";
import { RaffleOrdersList } from "@/components/raffles/raffle-client";
import { quotaLabel, type Raffle, type RaffleOrder, type RaffleAward } from "@/lib/raffles";
export const metadata = { title: "Rifas dos Caras" };
export const instant = false;
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { customer } = await requireCustomer(); const params = await searchParams;
  const tab = ["orders", "awards"].includes(String(params.tab)) ? String(params.tab) : "participate";
  const page = Math.min(10000, Math.max(1, Math.trunc(Number(params.page) || 1)));
  const db = await createClient(); let content: React.ReactNode; let total = 0; let more = false;
  if (tab === "participate") {
    const r = await db.from("raffle_campaigns").select("*", { count: "exact" }).in("status", ["open", "paused", "closed"]).is("archived_at",null).order("created_at", { ascending: false }).order("id").range((page - 1) * 10, page * 10 - 1);
    total = r.count ?? 0; more = page * 10 < total;
    content = r.error ? <RaffleUnavailable /> : r.data?.length ? <div className="grid gap-5 sm:grid-cols-2">{(r.data as Raffle[]).map(c => <RaffleCard key={c.id} campaign={c} />)}</div> : <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">As próximas campanhas aparecerão aqui.</p>;
  } else {
    const awards = tab === "awards" ? await db.rpc("get_raffle_awards", { p_page: page }) : { data: [], error: null }; const won = (awards.data ?? []) as RaffleAward[]; more = won.length === 20;
    if (tab === "awards") content = awards.error ? <RaffleUnavailable /> : won.length ? <div className="grid gap-4">{won.map(a => <article key={a.id} className="grid gap-3 rounded-xl border bg-card p-5"><p className="flex items-center gap-2 text-sm font-bold text-ouro-ink"><Gift className="size-5" />{a.kind === "instant" ? "Cota premiada" : "Prêmio principal"}</p><h2 className="text-lg font-bold">{a.title}</h2><p className="text-sm">{a.campaign_title} · Cota {quotaLabel(a.number, a.total_numbers)}</p><p className="text-sm font-semibold">{(a.cancelled_at || (a.order_status && a.order_status !== "paid")) ? "Prêmio em análise pela equipe" : a.shipment_status === "delivered" ? "Entregue" : a.shipment_id ? "Vinculado ao envio" : a.moved_at ? "Separado na sua caixa" : "Aguardando separação"}</p>{a.tracking_code && <p className="break-all text-sm">Rastreio: {a.tracking_code}</p>}{a.shipment_id && <Link className="text-sm underline" href="/painel/envios">Acompanhar envio</Link>}</article>)}</div> : <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Seus prêmios conquistados aparecerão aqui, com o acompanhamento da entrega.</p>;
    else {
      const r = await db.from("raffle_orders").select("*,campaign:raffle_campaigns(title,total_numbers)", { count: "exact" }).eq("customer_id", customer.id).order("created_at", { ascending: false }).order("id").range((page - 1) * 10, page * 10 - 1);
      total = r.count ?? 0; more = page * 10 < total;
      const orderAwards = r.error ? { data: [], error: r.error } : await db.rpc("get_raffle_awards", { p_orders: (r.data ?? []).map(o => o.id) });
      content = r.error || orderAwards.error ? <RaffleUnavailable /> : r.data?.length ? <RaffleOrdersList orders={r.data.map(o => ({ ...o, campaign_title: o.campaign?.title, total_numbers: o.campaign?.total_numbers } as RaffleOrder))} awards={(orderAwards.data ?? []) as RaffleAward[]} /> : <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Você ainda não possui participações. Escolha uma campanha em Participar.</p>;
    }
  }
  return <div className="grid gap-5"><header><h1 className="flex items-center gap-2 text-2xl font-bold"><Ticket className="text-ouro-ink" />Rifas dos Caras</h1><p className="mt-1 text-sm text-muted-foreground">Participe, acompanhe suas cotas e confira seus prêmios.</p></header><nav aria-label="Seções de rifas" className="grid grid-cols-3 gap-1 border-b pb-2">{[["participate", "Participar"], ["orders", "Minhas cotas"], ["awards", "Meus prêmios"]].map(([key, label]) => <Link key={key} href={`?tab=${key}`} aria-current={tab === key ? "page" : undefined} className={`rounded-lg px-1 py-3 text-center text-xs font-semibold ${tab === key ? "bg-amarelo/15 text-ouro-ink" : "text-muted-foreground"}`}>{label}</Link>)}</nav>{content}{<div className="flex justify-between gap-3 text-sm"><span>Página {page}</span><div className="flex gap-4">{page > 1 && <Link className="underline" href={`?tab=${tab}&page=${page - 1}`}>Anterior</Link>}{more && <Link className="underline" href={`?tab=${tab}&page=${page + 1}`}>Próxima</Link>}</div></div>}</div>;
}
