import { raffleNetRevenue } from "@/lib/raffle-presentation";
import Link from "next/link";
import { ArrowUpRight, Gift, MoreHorizontal, Plus, Search } from "lucide-react";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import type { Raffle } from "@/lib/raffles";
import { raffleMoney, raffleStatus } from "@/lib/raffles";
import { RaffleUnavailable } from "@/components/raffles/raffle-shared";
import { RaffleLifecycleButtons } from "@/components/raffles/raffle-admin";
import { RaffleBadge, RaffleEmpty, RafflePagination, RaffleProgress } from "@/components/raffles/raffle-ui";
import { readRafflePresentation } from "@/lib/raffle-presentation-server";
export const metadata = { title: "Campanhas de rifas" };
export const instant = false;
export default async function RafflePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { profile } = await requireAdmin(); const params = await searchParams;
  const status = ["draft", "open", "paused", "closed", "archived"].includes(String(params.status)) ? String(params.status) : "open";
  const q = String(params.q ?? "").trim().slice(0, 100);
  const page = Math.min(10000, Math.max(1, Math.trunc(Number(params.page) || 1)));
  const db = await createClient();
  let query = db.from("raffle_campaigns").select("*", { count: "exact" });
  query = status === "archived" ? query.not("archived_at", "is", null) : query.is("archived_at", null).eq("status", status);
  if (q) query = query.ilike("title", `%${q.replace(/[%_]/g, "")}%`);
  const { data, error, count } = await query.order("created_at", { ascending: false }).order("id").range((page - 1) * 12, page * 12 - 1);
  const campaigns = (data ?? []) as Raffle[];
  let summary: Awaited<ReturnType<typeof readRafflePresentation>> | null = null;
  try { summary = await readRafflePresentation(campaigns.map(c => c.id)); } catch { /* Não mostrar indicadores inventados quando a consulta falhar. */ }
  const href = (next: string, page = 1) => `?${new URLSearchParams({ status: next, q, page: String(page) })}`;
  return <main className="grid min-w-0 gap-6 p-4 md:p-8"><header className="rf-heading"><div><p className="rf-eyebrow mb-2">RIFA / CAMPANHAS</p><h1>Suas campanhas</h1><p>Organize os prêmios, acompanhe as cotas e registre cada conquista.</p></div>{profile.role !== "viewer" && <Link className="rf-button rf-button-primary" href="/admin/rifa/nova"><Plus size={16} />Nova campanha</Link>}</header>
    <div className="rf-panel grid gap-4"><form className="rf-search" action="/admin/rifa"><Search size={16} className="shrink-0 text-muted-foreground" /><input name="q" aria-label="Buscar campanha" defaultValue={q} placeholder="Buscar campanha pelo nome" maxLength={100} /><input name="status" value={status} type="hidden" /><button type="submit" className="text-xs font-semibold text-ouro-ink">Buscar</button></form><nav aria-label="Status das campanhas" className="rf-tabs">{[["open", "Em andamento"], ["paused", "Pausadas / apuração"], ["draft", "Rascunhos"], ["closed", "Encerradas"], ["archived", "Arquivadas"]].map(([key, label]) => <Link key={key} aria-current={status === key ? "page" : undefined} href={href(key)}>{label}</Link>)}</nav></div>
    {error ? <RaffleUnavailable /> : campaigns.length ? <div className="rf-table-wrap"><table className="rf-table"><thead><tr>{["Campanha", "Situação", "Cotas", "Recebido líquido", "Ações"].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{campaigns.map(c => { const stats = summary?.complete ? summary.summaries[c.id] ?? { paid: 0, reserved: 0, received: 0, instantPrizes: 0 } : null; const ready = c.status === "paused" && stats && stats.paid >= c.total_numbers; return <tr key={c.id}>
      <td><Link className="flex min-w-0 items-center gap-3" href={`/admin/rifa/${c.id}`}>{c.image_url ? <picture><img className="rf-small-photo" src={c.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" /></picture> : <span className="rf-icon-tile"><Gift size={20} /></span>}<div className="min-w-0"><span className="rf-table-title">{c.title}</span><span className="rf-caption mt-1 block">{raffleMoney(c.unit_price)} por cota</span></div></Link></td>
      <td data-label="Situação"><RaffleBadge status={c.status}>{c.archived_at ? "Arquivada" : ready ? "Pronta para apuração" : raffleStatus[c.status]}</RaffleBadge></td>
      <td data-label="Cotas"><div className="min-w-24 max-w-40">{stats ? <><strong className="mb-2 block tabular-nums">{stats.paid}/{c.total_numbers}</strong><RaffleProgress paid={stats.paid} reserved={stats.reserved} total={c.total_numbers} /></> : <span>{c.total_numbers} cotas</span>}</div></td>
      <td data-label="Recebido líquido"><strong className="whitespace-nowrap tabular-nums">{stats ? raffleMoney(raffleNetRevenue(stats.received).net) : "—"}</strong>{stats && <p className="rf-caption mt-1">Bruto: {raffleMoney(stats.received)} · API 1%: {raffleMoney(raffleNetRevenue(stats.received).fee)}</p>}</td>
      <td data-label="Ações"><div className="flex flex-wrap items-center gap-2"><Link className={`rf-button ${ready ? "rf-button-primary" : ""}`} href={`/admin/rifa/${c.id}${ready ? "?tab=result" : ""}`}>{ready ? "Apurar" : c.status === "closed" ? "Ver resultado" : "Gerenciar"}<ArrowUpRight size={14} /></Link>{profile.role !== "viewer" && <details><summary aria-label={`Mais ações de ${c.title}`} className="cursor-pointer list-none rounded-md border p-2"><MoreHorizontal size={16} /></summary><div className="mt-2"><RaffleLifecycleButtons campaign={c} owner={profile.role === "owner"} /></div></details>}</div></td>
    </tr>; })}</tbody></table></div> : <RaffleEmpty title="Nenhuma campanha neste filtro" description="Busque por outro nome ou comece uma nova campanha pelo rascunho." href={profile.role !== "viewer" ? "/admin/rifa/nova" : undefined} action="Criar campanha" />}
    {summary && !summary.complete && <p className="rf-caption">Há um volume grande de registros. Os indicadores não foram exibidos para evitar valores parciais.</p>}
    <RafflePagination page={page} more={page * 12 < (count ?? 0)} count={count ?? 0} href={p => href(status, p)} />
  </main>;
}
