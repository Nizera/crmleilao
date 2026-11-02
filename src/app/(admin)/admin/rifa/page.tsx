import Link from "next/link";
import { Plus, Ticket } from "lucide-react";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import type { Raffle } from "@/lib/raffles";
import { RaffleCard, RaffleUnavailable } from "@/components/raffles/raffle-shared";
import { RaffleLifecycleButtons } from "@/components/raffles/raffle-admin";
import { Button } from "@/components/ui/button";
export const metadata = { title: "Campanhas de rifas" };
export const instant = false;
export default async function RafflePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { profile } = await requireAdmin(); const params = await searchParams;
  const status = ["draft", "open", "paused", "closed", "archived"].includes(String(params.status)) ? String(params.status) : "open";
  const page = Math.min(10000, Math.max(1, Math.trunc(Number(params.page) || 1)));
  let query = (await createClient()).from("raffle_campaigns").select("*", { count: "exact" });
  query=status==="archived"?query.not("archived_at","is",null):query.is("archived_at",null).eq("status",status);
  const { data, error, count } = await query.order("created_at", { ascending: false }).order("id").range((page - 1) * 12, page * 12 - 1);
  return <main className="grid gap-6 p-4 md:p-8"><header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="flex items-center gap-2 text-2xl font-bold"><Ticket className="text-ouro-ink" />Campanhas de rifas</h1><p className="mt-1 text-sm text-muted-foreground">Campanhas, cotas e prêmios no mesmo cadastro do cliente.</p></div>{profile.role !== "viewer" && <Button asChild><Link href="/admin/rifa/nova"><Plus />Criar campanha</Link></Button>}</header><nav aria-label="Status das campanhas" className="flex flex-wrap gap-2">{[["open", "Em andamento"], ["draft", "Rascunhos"], ["paused", "Pausadas"], ["closed", "Encerradas"], ["archived", "Arquivadas"]].map(([key, label]) => <Button key={key} variant={status === key ? "default" : "outline"} asChild><Link href={`?status=${key}`}>{label}</Link></Button>)}</nav>{error ? <RaffleUnavailable /> : <><div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{(data as Raffle[]).map(c => <div key={c.id} className="grid content-start gap-3"><RaffleCard campaign={c} admin />{profile.role!=="viewer"&&<RaffleLifecycleButtons campaign={c} owner={profile.role==="owner"}/>}</div>)}</div>{!data?.length && <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhuma campanha neste filtro. Crie uma campanha e comece pelo rascunho.</p>}<div className="flex items-center justify-between text-sm"><span>{count ?? 0} campanha(s) · Página {page}</span><div className="flex gap-3">{page > 1 && <Link className="underline" href={`?status=${status}&page=${page - 1}`}>Anterior</Link>}{page * 12 < (count ?? 0) && <Link className="underline" href={`?status=${status}&page=${page + 1}`}>Próxima</Link>}</div></div></>}</main>;
}
