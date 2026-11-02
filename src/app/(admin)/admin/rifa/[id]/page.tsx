import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { RaffleAdminControls, RaffleLifecycleButtons } from "@/components/raffles/raffle-admin";
import { RaffleUnavailable } from "@/components/raffles/raffle-shared";
import { raffleMoney, type Raffle } from "@/lib/raffles";
export const metadata = { title: "Gerenciar rifa" };
export const instant = false;
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { profile } = await requireAdmin(); const { id } = await params;
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
  return <main className="grid min-w-0 gap-5 p-4 md:p-8"><Link className="text-sm underline" href="/admin/rifa">Voltar às campanhas</Link><header><h1 className="text-2xl font-bold">{c.title}</h1><p className="mt-1 text-sm text-muted-foreground">De 000 até {String(c.total_numbers - 1).padStart(3, "0")} · {c.hide_winning_numbers ? "Cotas premiadas ocultas" : "Cotas premiadas visíveis"}</p></header>{profile.role!=="viewer"&&<RaffleLifecycleButtons campaign={c} owner={profile.role==="owner"}/>}<div className="grid gap-3 sm:grid-cols-3">{[["Arrecadado", raffleMoney(s?.received ?? 0)], ["Cotas pagas", s?.paid ?? 0], ["Cotas reservadas", s?.reserved ?? 0]].map(([label, value]) => <div key={label} className="rounded-xl border p-5"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p></div>)}</div>{profile.role !== "viewer" ? <RaffleAdminControls campaign={c} prizes={prizes.data ?? []} awarded={awards.data ?? []} /> : <p>Seu perfil permite apenas consultar esta campanha.</p>}</main>;
}
