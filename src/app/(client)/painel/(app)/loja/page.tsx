import Link from "next/link";
import { ArrowLeft, Coins, Trophy } from "lucide-react";
import { requireCustomer } from "@/lib/dal";
import { getCustomerLoyaltyData } from "@/lib/loyalty";
import { getCustomerStoreOrders } from "@/lib/store-server";
import { coinNumber, isStoreOrderOpen } from "@/lib/store";
import { LoyaltyStorefront } from "@/components/client/loyalty-storefront";
import { StoreOrders } from "@/components/client/store-orders";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Loja Caracoins" };
const date = (value: string) => new Date(value).toLocaleDateString("pt-BR");
const kinds: Record<string,string> = { earned: "Caracoins por lote pago", spent: "Compra ou resgate", reversal: "Estorno de lote", adjustment: "Ajuste ou devolução" };
const statuses: Record<string,string> = { pending: "Aguardando análise", approved: "Aprovado", fulfilled: "Concluído", rejected: "Recusado · Caracoins devolvidas" };

export default async function ClientLoyaltyPage() {
  const { customer } = await requireCustomer();
  const [data, store] = await Promise.all([
    getCustomerLoyaltyData(customer.id).catch(() => null), getCustomerStoreOrders(customer.id),
  ]);
  if (!data) return <div className="rounded-xl border p-6 text-center"><h1 className="text-xl font-semibold">Loja temporariamente indisponível</h1><p className="mt-2 text-sm text-muted-foreground">Tente novamente em instantes.</p></div>;
  const { settings, balance, rewards, redemptions, ledger } = data;
  return <div className="grid gap-5">
    <header><Button asChild variant="ghost" size="sm" className="-ml-2"><Link href="/painel"><ArrowLeft /> Voltar ao painel</Link></Button><h1 className="mt-3 text-2xl font-bold">Loja dos Caras</h1><p className="mt-1 text-sm text-muted-foreground">Escolha seus produtos e compre com Caracoins, reais ou os dois juntos.</p></header>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ouro/30 bg-amarelo/10 p-4"><div><p className="text-xs text-muted-foreground">Caracoins disponíveis</p><p className="mt-1 flex items-center gap-2 text-2xl font-bold text-ouro-ink"><Coins className="size-6" />{coinNumber(balance)}</p></div><Button asChild size="sm" variant="outline"><Link href="/painel/ranking"><Trophy /> Ranking</Link></Button></div>
    <StoreOrders orders={store.orders} />
    {!store.ready ? <p className="rounded-xl border p-5 text-sm text-muted-foreground">Estamos atualizando a loja para receber carrinhos e pagamentos por Pix. Ela estará disponível em breve.</p> : !settings.active ? <p className="rounded-xl border p-5 text-sm text-muted-foreground">A loja está em preparação. Seus pedidos continuam disponíveis nesta página.</p> : <LoyaltyStorefront rewards={rewards.map((reward) => ({ ...reward, image_path: reward.image_path ?? null }))} balance={balance} customerId={customer.id} hasOpenOrder={store.orders.some(isStoreOrderOpen)} />}
    <StoreOrders orders={store.orders} history />
    {redemptions.length > 0 && <details className="rounded-xl border p-4"><summary className="cursor-pointer font-semibold">Resgates anteriores ({redemptions.length})</summary><div className="mt-3 grid gap-3">{redemptions.map((item) => <div key={item.id} className="border-b pb-2 text-sm last:border-0"><p className="font-semibold">{item.reward_name} · {coinNumber(Number(item.points_cost))} Caracoins</p><p className="text-xs text-muted-foreground">{date(item.created_at)} · {statuses[item.status] ?? item.status}</p>{item.admin_note && <p className="mt-1 text-xs text-muted-foreground">{item.admin_note}</p>}</div>)}</div></details>}
    <details className="rounded-xl border p-4"><summary className="cursor-pointer font-semibold">Extrato de Caracoins</summary><p className="mt-2 text-xs text-muted-foreground">Caracoins são geradas pelos lotes pagos. Compras na loja não geram Caracoins nem alteram o total gasto em lotes.</p><div className="mt-4 grid gap-3">{ledger.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma movimentação ainda.</p> : ledger.map((row) => <div key={row.id} className="flex items-center justify-between gap-3 border-b pb-2 text-sm last:border-0"><div><p className="font-medium">{kinds[row.kind] ?? row.kind}</p><p className="text-xs text-muted-foreground">{row.note || "—"} · {date(row.created_at)}</p></div><span className={Number(row.points) > 0 ? "shrink-0 font-semibold text-emerald-600" : "shrink-0 font-semibold text-destructive"}>{Number(row.points) > 0 ? "+" : ""}{coinNumber(Number(row.points))}</span></div>)}</div></details>
  </div>;
}
