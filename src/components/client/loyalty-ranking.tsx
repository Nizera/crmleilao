import { Trophy } from "lucide-react";
import { updateLoyaltyRankingVisibility } from "@/app/actions/loyalty";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLoyaltyTier, LOYALTY_TIERS } from "@/lib/loyalty-tiers";
import type { LoyaltyTierLeader } from "@/lib/loyalty";

const number = (value: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);

export function LoyaltyRanking({
  enabled,
  rankVisible,
  tierLeaders,
  rankPoints,
}: {
  enabled: boolean;
  rankVisible: boolean;
  tierLeaders: LoyaltyTierLeader[];
  rankPoints: number;
}) {
  const currentTier = getLoyaltyTier(rankPoints);
  const currentTierIndex = LOYALTY_TIERS.findIndex((tier) => tier.key === currentTier.key);
  const nextTier = LOYALTY_TIERS[currentTierIndex + 1];
  const progress = nextTier
    ? Math.min(100, Math.max(0, ((rankPoints - currentTier.min) / (nextTier.min - currentTier.min)) * 100))
    : 100;

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Trophy className="size-5 text-ouro-ink" /> Seu elo e o ranking</CardTitle>
        <CardDescription>Seu elo é definido pelos pontos ganhos com lotes pagos. Frete não gera pontos, e resgatar recompensas não reduz seu elo. Cada pagamento rende pontos pela taxa do elo em que você está; os lotes de um mesmo Pix usam a mesma taxa.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="rounded-xl border border-ouro/30 bg-amarelo/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Seu elo atual</p><p className="text-2xl font-bold text-ouro-ink">{currentTier.name}</p></div>
            <p className="text-sm font-semibold">{number(rankPoints)} pontos ganhos</p>
          </div>
          {nextTier ? <><div className="mt-3 h-2 overflow-hidden rounded-full bg-background"><div className="h-full rounded-full bg-ouro" style={{ width: `${progress}%` }} /></div><p className="mt-2 text-xs text-muted-foreground">Faltam {number(Math.max(0, nextTier.min - rankPoints))} pontos para chegar ao elo {nextTier.name}.</p></> : <p className="mt-2 text-xs text-muted-foreground">Você alcançou o elo mais alto!</p>}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {LOYALTY_TIERS.map((tier) => {
            const leader = tierLeaders.find((row) => row.tier_key === tier.key);
            return <div key={tier.key} className={`rounded-xl border p-3 ${tier.key === currentTier.key ? "border-ouro/50 bg-amarelo/5" : "bg-card"}`}>
              <div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{tier.name}</p><p className="text-[11px] text-muted-foreground">{tier.range}</p></div><span className="rounded-full bg-muted px-2 py-1 text-[10px] font-semibold">{tier.rate}</span></div>
              <div className="mt-3 border-t pt-2"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Top 1 deste elo</p><p className="mt-0.5 truncate text-sm font-medium">{enabled ? leader?.customer_name ?? "Ainda sem participante" : "Ranking em preparação"}</p>{leader?.points != null && <p className="text-xs text-muted-foreground">{number(Number(leader.points))} pts</p>}</div>
            </div>;
          })}
        </div>
        {enabled && <form action={updateLoyaltyRankingVisibility} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/50 p-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="visible" defaultChecked={rankVisible} className="accent-yellow-500" /> Quero aparecer no ranking</label><Button type="submit" size="sm" variant="outline">Salvar preferência</Button></form>}
        <p className="text-xs text-muted-foreground">A faixa mostra os pontos ganhos acumulados. Participar da lista pública é opcional; quem participa aparece com o primeiro nome e a inicial do sobrenome.</p>
      </CardContent>
    </Card>
  );
}
