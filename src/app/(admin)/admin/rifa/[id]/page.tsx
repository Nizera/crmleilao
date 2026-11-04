import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { RaffleAdminControls, RaffleLifecycleButtons } from "@/components/raffles/raffle-admin";
import { RaffleUnavailable } from "@/components/raffles/raffle-shared";
import { ArrowLeft, ArrowUpRight, Clock3, Coins, Ticket } from "lucide-react";
import { RaffleBadge, RaffleMetric } from "@/components/raffles/raffle-ui";
import { raffleMoney, type Raffle } from "@/lib/raffles";
export const metadata = { title: "Gerenciar rifa" };
export const instant = false;
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { profile } = await requireAdmin(); const { id } = await params; const query = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = await createClient();
  const [campaign, prizes, stats, awards] = await Promise.all([
    db.from("raffle_campaigns").select("*").eq("id", id).maybeSingle(),
    db.from("raffle_prizes").select("id,title,kind,number").eq("campaign_id", id).order("kind").order("id"),
    db.rpc("get_raffle_admin_stats", { p_campaign: id }), db.rpc("get_raffle_admin_awarded", { p_campaign: id }),
  ]);
  if (campaign.error || prizes.error || stats.error || awards.error) return <main className="p-6"><RaffleUnavailable /></main>;
  if (!campaign.data) notFound();
  const c = campaign.data as Raffle; const s = stats.data;
  return <main className="grid min-w-0 gap-5 p-4 md:p-8"><Link className="flex w-fit items-center gap-2 text-xs text-muted-foreground hover:text-foreground" href="/admin/rifa"><ArrowLeft size={14} />Voltar às campanhas</Link><header className="rf-heading"><div className="flex min-w-0 items-start gap-4">{c.image_url && <picture><img className="h-20 w-16 shrink-0 rounded-xl border bg-muted object-contain" src={c.image_url} alt="" referrerPolicy="no-referrer" /></picture>}<div className="min-w-0"><div className="mb-2"><RaffleBadge status={c.status}>{c.archived_at ? "Arquivada" : c.status === "paused" && s?.paid >= c.total_numbers ? "Pronta para apuração" : undefined}</RaffleBadge></div><h1>{c.title}</h1><p>{s?.paid ?? 0} de {c.total_numbers} cotas pagas · De 000 até {String(c.total_numbers - 1).padStart(3, "0")}</p></div></div><div className="flex flex-wrap gap-2"><Link className="rf-button" href={`/painel/rifas/${c.id}`} target="_blank" rel="noopener noreferrer">Ver página<ArrowUpRight size={15} /></Link>{profile.role !== "viewer" && <RaffleLifecycleButtons campaign={c} owner={profile.role === "owner"} />}</div></header><div className="grid gap-3 sm:grid-cols-3"><RaffleMetric label="Recebido na campanha" value={raffleMoney(s?.received ?? 0)} hint="Somente pagamentos confirmados" icon={Coins} /><RaffleMetric label="Cotas pagas" value={s?.paid ?? 0} hint={`${c.total_numbers} cotas no total`} icon={Ticket} /><RaffleMetric label="Cotas reservadas" value={s?.reserved ?? 0} hint="Aguardando pagamento ou conferência" icon={Clock3} /></div>{profile.role !== "viewer" ? <RaffleAdminControls key={c.id} campaign={c} prizes={prizes.data ?? []} awarded={awards.data ?? []} initialTab={String(query.tab ?? "summary")} paid={s?.paid ?? 0} reserved={s?.reserved ?? 0} /> : <p className="rf-panel text-sm text-muted-foreground">Seu perfil permite apenas consultar esta campanha.</p>}</main>;
}
