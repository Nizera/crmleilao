import Link from "next/link";
import { Award, ArrowDownToLine, ArrowLeft, History, Sparkles, Trophy } from "lucide-react";
import { requireCustomer } from "@/lib/dal";
import { getCustomerLoyaltyData } from "@/lib/loyalty";
import { updateLoyaltyRankingVisibility } from "@/app/actions/loyalty";
import { LoyaltyStorefront } from "@/components/client/loyalty-storefront";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Loja de pontos" };
const number = (value: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(value);
const tiers = [
  { key: "lilas", name: "Lilás", range: "Menos de R$ 1.000", rate: "0,5 pt por real", min: 0, max: 1000 },
  { key: "bronze", name: "Bronze", range: "R$ 1.000 a menos de R$ 5.000", rate: "1 pt por real", min: 1000, max: 5000 },
  { key: "prata", name: "Prata", range: "R$ 5.000 a menos de R$ 15.000", rate: "1,5 pt por real", min: 5000, max: 15000 },
  { key: "ouro", name: "Ouro", range: "R$ 15.000 a menos de R$ 25.000", rate: "2 pts por real", min: 15000, max: 25000 },
  { key: "crumple", name: "Crumple", range: "R$ 25.000 a menos de R$ 50.000", rate: "2,5 pts por real", min: 25000, max: 50000 },
  { key: "prizm", name: "Prizm", range: "R$ 50.000 ou mais", rate: "3 pts por real", min: 50000, max: Infinity },
] as const;
const date = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(value));
const kinds: Record<string, string> = { earned: "Lote pago", spent: "Resgate solicitado", reversal: "Estorno de lote", adjustment: "Ajuste da equipe" };
const statuses: Record<string, string> = { pending: "Aguardando análise", approved: "Aprovado", fulfilled: "Concluído", rejected: "Recusado · pontos devolvidos" };

export default async function ClientLoyaltyPage({ searchParams }: PageProps<"/painel/loja">) {
  const { customer } = await requireCustomer();
  const params = await searchParams;
  let data: Awaited<ReturnType<typeof getCustomerLoyaltyData>> | null = null;
  try {
    data = await getCustomerLoyaltyData(customer.id);
  } catch {
    // Allows the rest of the production app to remain usable until migration
    // 0019 has been applied to the database.
  }
  if (!data) return <div className="flex flex-col gap-5"><Button asChild variant="ghost" size="sm" className="w-fit -ml-2"><Link href="/painel"><ArrowLeft /> Voltar ao painel</Link></Button><Card><CardContent className="flex flex-col items-center gap-3 py-10 text-center"><Sparkles className="size-9 text-amarelo" /><h1 className="text-xl font-semibold">Estamos preparando a loja de pontos</h1><p className="max-w-md text-sm text-muted-foreground">Em breve você poderá acompanhar seus pontos e trocar por recompensas. Seus pagamentos e lotes continuam funcionando normalmente.</p></CardContent></Card></div>;
  const { settings, balance, ledger, rewards, redemptions, rankVisible, tierLeaders, totalSpent } = data;
  const currentTier = [...tiers].reverse().find((tier) => totalSpent >= tier.min) ?? tiers[0];
  const currentTierIndex = tiers.findIndex((tier) => tier.key === currentTier.key);
  const nextTier = tiers[currentTierIndex + 1];
  const tierProgress = nextTier
    ? Math.min(100, Math.max(0, ((totalSpent - currentTier.min) / (nextTier.min - currentTier.min)) * 100))
    : 100;

  return <div className="flex flex-col gap-5">
    <div className="flex flex-col gap-3"><Button asChild variant="ghost" size="sm" className="w-fit -ml-2"><Link href="/painel"><ArrowLeft /> Voltar ao painel</Link></Button><div><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.18em] text-ouro-ink"><Sparkles className="size-4" /> Benefícios OCDL</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">Loja de pontos</h1><p className="text-sm text-muted-foreground">Pontos de fidelidade são separados dos valores em reais e dos fretes.</p></div></div>

    {params.erro && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{params.erro}</div>}
    {params.resgatado && <div role="status" className="rounded-lg border border-ouro/30 bg-amarelo/10 px-4 py-3 text-sm">Pedido de resgate enviado. A equipe vai acompanhar por aqui.</div>}
    {params.salvo && <div role="status" className="rounded-lg border border-ouro/30 bg-amarelo/10 px-4 py-3 text-sm">Sua preferência foi atualizada.</div>}

    <Card className="overflow-hidden border-ouro/35 bg-linear-to-br from-amarelo/15 via-card to-card"><CardContent className="flex flex-wrap items-center justify-between gap-4 p-5"><div><p className="text-sm text-muted-foreground">Seu saldo de pontos</p><p className="mt-1 flex items-baseline gap-2 text-4xl font-bold tracking-tight"><Award className="size-7 text-amarelo" /> {number(balance)}</p><p className="mt-2 text-xs text-muted-foreground">Pontos não expiram durante o piloto. Frete não gera pontos.</p></div><span className="rounded-full bg-background/70 px-3 py-1.5 text-xs font-semibold ring-1 ring-border">{settings.active ? "Programa ativo" : "Programa em preparação"}</span></CardContent></Card>

    <Card className="overflow-hidden">
      <CardHeader><CardTitle className="flex items-center gap-2"><Trophy className="size-5 text-ouro-ink" /> Seu ranking</CardTitle><CardDescription>Seu elo é calculado pelo total gasto em lotes pagos. Frete e pontos resgatados não alteram o elo. A cada pagamento, você ganha pontos pela taxa do elo que já alcançou; todos os lotes do mesmo Pix usam a mesma taxa. O próximo pagamento usa o elo atualizado, sem recalcular pontos antigos.</CardDescription></CardHeader>
      <CardContent className="grid gap-4">
        <div className="rounded-xl border border-ouro/30 bg-amarelo/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Seu elo atual</p><p className="text-2xl font-bold text-ouro-ink">{currentTier.name}</p></div><p className="text-sm font-semibold">{money(totalSpent)} em lotes pagos</p></div>
          {nextTier ? <><div className="mt-3 h-2 overflow-hidden rounded-full bg-background"><div className="h-full rounded-full bg-ouro" style={{ width: `${tierProgress}%` }} /></div><p className="mt-2 text-xs text-muted-foreground">Faltam {money(Math.max(0, nextTier.min - totalSpent))} para chegar ao elo {nextTier.name}.</p></> : <p className="mt-2 text-xs text-muted-foreground">Você alcançou o elo mais alto!</p>}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{tiers.map((tier) => {
          const leader = tierLeaders.find((row) => row.tier_key === tier.key);
          return <div key={tier.key} className={`rounded-xl border p-3 ${tier.key === currentTier.key ? "border-ouro/50 bg-amarelo/5" : "bg-card"}`}><div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{tier.name}</p><p className="text-[11px] text-muted-foreground">{tier.range}</p></div><span className="rounded-full bg-muted px-2 py-1 text-[10px] font-semibold">{tier.rate}</span></div><div className="mt-3 border-t pt-2"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Top 1 deste elo</p><p className="mt-0.5 truncate text-sm font-medium">{settings.active && settings.ranking_enabled ? leader?.customer_name ?? "Ainda sem participante" : "Ranking em preparação"}</p>{leader?.points != null && <p className="text-xs text-muted-foreground">{number(Number(leader.points))} pts</p>}</div></div>;
        })}</div>
        {settings.active && settings.ranking_enabled && <form action={updateLoyaltyRankingVisibility} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/50 p-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="visible" defaultChecked={rankVisible} className="accent-yellow-500" /> Quero aparecer no ranking</label><Button type="submit" size="sm" variant="outline">Salvar preferência</Button></form>}
        <p className="text-xs text-muted-foreground">A participação é voluntária. Se optar por aparecer, seu nome será mostrado de forma abreviada. O líder de cada elo é quem tem o maior gasto acumulado naquela faixa entre participantes.</p>
      </CardContent>
    </Card>

    {!settings.active ? <Card><CardContent className="flex gap-3 py-4"><Sparkles className="mt-0.5 size-5 shrink-0 text-ouro-ink" /><div><p className="font-semibold">Estamos preparando as recompensas</p><p className="mt-1 text-sm text-muted-foreground">A equipe ainda está definindo as regras. Seus lotes pagos anteriores não serão recalculados quando o programa começar.</p></div></CardContent></Card> : rewards.length === 0 ? <Card><CardContent className="py-7 text-center text-sm text-muted-foreground">Novas recompensas em breve.</CardContent></Card> : <LoyaltyStorefront rewards={rewards.map((reward) => ({ ...reward, image_path: reward.image_path ?? null }))} balance={balance} />}

    <Card><CardHeader><CardTitle className="flex items-center gap-2"><History className="size-5" /> Seus resgates</CardTitle><CardDescription>A equipe atualiza o andamento por aqui.</CardDescription></CardHeader><CardContent className="grid gap-3">{redemptions.length === 0 ? <p className="text-sm text-muted-foreground">Você ainda não fez resgates.</p> : redemptions.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-0"><div><p className="text-sm font-semibold">{item.reward_name}</p><p className="text-xs text-muted-foreground">{date(item.created_at)} · {statuses[item.status] ?? item.status}</p>{item.admin_note && <p className="mt-1 text-xs text-muted-foreground">{item.admin_note}</p>}</div><span className="text-sm font-semibold">−{number(Number(item.points_cost))} pts</span></div>)}</CardContent></Card>

    <Card><CardHeader><CardTitle className="flex items-center gap-2"><ArrowDownToLine className="size-5" /> Extrato de pontos</CardTitle><CardDescription>Pontos entram quando o pagamento do lote é confirmado. Estornos e ajustes aparecem aqui.</CardDescription></CardHeader><CardContent className="grid gap-2">{ledger.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma movimentação ainda.</p> : ledger.map((row) => <div key={row.id} className="flex items-center justify-between gap-3 border-b pb-2 text-sm last:border-0"><div><p className="font-medium">{kinds[row.kind] ?? row.kind}</p><p className="text-xs text-muted-foreground">{row.note || "—"} · {date(row.created_at)}</p></div><span className={Number(row.points) > 0 ? "font-semibold text-emerald-600" : "font-semibold text-destructive"}>{Number(row.points) > 0 ? "+" : ""}{number(Number(row.points))} pts</span></div>)}</CardContent></Card>
  </div>;
}
