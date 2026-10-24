import Link from "next/link";
import { Coins, Gift, PackageCheck, Sparkles } from "lucide-react";
import { requireAdmin } from "@/lib/dal";
import { getAdminLoyaltyData } from "@/lib/loyalty";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoyaltyAdminShell, LoyaltyMigrationWarning, loyaltyBRL, loyaltyNumber } from "@/components/admin/loyalty/loyalty-admin-shell";

export const metadata = { title: "Fidelidade e loja de pontos" };

export default async function LoyaltyAdminPage({ searchParams }: PageProps<"/admin/fidelidade">) {
  await requireAdmin();
  const params = await searchParams;
  const { settings, redemptions, ledger, stats, error } = await getAdminLoyaltyData();
  const query = (key: string) => Array.isArray(params[key]) ? params[key]?.[0] : params[key];
  if (error || !settings) return <LoyaltyAdminShell active="resumo"><LoyaltyMigrationWarning error={error} /></LoyaltyAdminShell>;
  const pending = redemptions.filter((item) => item.status === "pending");
  const metrics = [[Coins, "Pontos emitidos", `${loyaltyNumber(stats?.total_earned)} pts`], [Sparkles, "Em circulação", `${loyaltyNumber(stats?.points_in_circulation)} pts`], [PackageCheck, "Resgates pendentes", loyaltyNumber(stats?.redemptions_pending)], [Gift, "Custo conhecido em estoque", loyaltyBRL(stats?.inventory_cost)]] as const;
  return <LoyaltyAdminShell active="resumo" programActive={settings.active} error={query("erro")} saved={Boolean(query("salvo"))}>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Resumo do programa">
      {metrics.map(([Icon, label, value]) => <Card key={label} size="sm"><CardContent className="flex items-center gap-3 pt-3"><span className="rounded-lg bg-amarelo/15 p-2 text-ouro-ink"><Icon className="size-4" /></span><div className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className="truncate text-lg font-semibold">{value}</p></div></CardContent></Card>)}
    </section>
    {!settings.active && <Card className="border-ouro/35 bg-amarelo/10"><CardHeader><CardTitle>A loja ainda não está ativa</CardTitle><CardDescription>Defina a regra de ganho, cadastre uma recompensa e ative o programa quando estiverem prontos. Lotes antigos não serão recalculados.</CardDescription></CardHeader><CardContent><Button asChild variant="outline"><Link href="/admin/fidelidade/configuracao">Configurar programa</Link></Button></CardContent></Card>}
    <section className="grid gap-5 xl:grid-cols-2">
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><PackageCheck className="size-5" /> Resgates aguardando análise</CardTitle><CardDescription>Pedidos recentes que precisam de uma ação da equipe.</CardDescription></CardHeader><CardContent className="grid gap-3">{pending.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum resgate pendente.</p> : pending.slice(0, 5).map((item) => { const customer = Array.isArray(item.customer) ? item.customer[0] : item.customer; return <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm last:border-0"><div><p className="font-medium">{item.reward_name}</p><p className="text-xs text-muted-foreground">{customer?.name || "Cliente"} · {loyaltyNumber(item.points_cost)} pts</p></div><span className="rounded-full bg-amarelo/15 px-2 py-1 text-xs">Pendente</span></div>; })}<Button asChild variant="outline" className="w-fit"><Link href="/admin/fidelidade/resgates">Abrir todos os resgates</Link></Button></CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Coins className="size-5" /> Atividade recente</CardTitle><CardDescription>Movimentações de pontos, sem misturar pagamentos ou fretes.</CardDescription></CardHeader><CardContent className="grid gap-3">{ledger.length === 0 ? <p className="text-sm text-muted-foreground">Ainda não há movimentações.</p> : ledger.slice(0, 5).map((row) => { const customer = Array.isArray(row.customer) ? row.customer[0] : row.customer; return <div key={row.id} className="flex items-center justify-between gap-3 border-b pb-2 text-sm last:border-0"><div className="min-w-0"><p className="truncate font-medium">{customer?.name || "Cliente"}</p><p className="text-xs text-muted-foreground">{row.kind} · {row.note || "Sem observação"}</p></div><span className={row.points > 0 ? "shrink-0 font-semibold text-emerald-600" : "shrink-0 font-semibold text-destructive"}>{row.points > 0 ? "+" : ""}{loyaltyNumber(row.points)} pts</span></div>; })}<Button asChild variant="outline" className="w-fit"><Link href="/admin/fidelidade/extrato">Ver extrato e ajustes</Link></Button></CardContent></Card>
    </section>
  </LoyaltyAdminShell>;
}
