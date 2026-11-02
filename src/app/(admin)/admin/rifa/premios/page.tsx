import Link from "next/link";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { quotaLabel, type RaffleAward } from "@/lib/raffles";
import { RaffleUnavailable } from "@/components/raffles/raffle-shared";
export const metadata = { title: "Prêmios de rifas" };
export const instant = false;
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin(); const params = await searchParams; const page = Math.min(10000, Math.max(1, Math.trunc(Number(params.page) || 1)));
  const { data, error } = await (await createClient()).rpc("get_raffle_awards", { p_page: page });
  const rows = (data ?? []) as (RaffleAward & { customer_name: string })[];
  return <main className="grid gap-5 p-4 md:p-8"><header><h1 className="text-2xl font-bold">Prêmios conquistados</h1><p className="mt-1 text-sm text-muted-foreground">Cada prêmio tem um único ganhador e entra automaticamente na separação, sem criar um arremate ou cobrar o valor do prêmio.</p></header><Link href="/admin/relatorios" className="text-sm underline">Abrir relatório de separação</Link>{error ? <RaffleUnavailable /> : <><div className="grid gap-3">{rows.map(a => <article key={a.id} className="grid gap-2 rounded-xl border p-4"><h2 className="font-bold">{a.title}</h2><p className="text-sm">{a.customer_name} · {a.campaign_title} · Cota {quotaLabel(a.number, a.total_numbers)}</p><p className="text-sm text-ouro-ink">{(a.cancelled_at || (a.order_status && a.order_status !== "paid")) ? "Em análise" : a.shipment_status === "delivered" ? "Entregue" : a.shipment_id ? "Vinculado ao envio" : a.moved_at ? "Na caixa do cliente" : "A separar"}</p><Link href={`/admin/rifa/${a.campaign_id}`} className="text-xs underline">Ver campanha</Link></article>)}</div>{!rows.length && <p className="rounded-xl border border-dashed p-6 text-sm">Nenhum prêmio conquistado nesta página.</p>}<div className="flex gap-4 text-sm">{page > 1 && <Link className="underline" href={`?page=${page - 1}`}>Anterior</Link>}{rows.length === 20 && <Link className="underline" href={`?page=${page + 1}`}>Próxima</Link>}</div></>}</main>;
}
