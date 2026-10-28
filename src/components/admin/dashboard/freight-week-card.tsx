import { TruckIcon } from "lucide-react";
import { formatBRL } from "@/lib/lots";
import type { AuctionPeriod } from "@/lib/auction-period";
import type { PeriodFreightStats } from "@/lib/dashboard-scope";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export function FreightPeriodCard({ stats, period, ready }: { stats: PeriodFreightStats; period: AuctionPeriod; ready: boolean }) {
  return <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><TruckIcon className="size-4 text-muted-foreground" />Fretes dos lotes do período</CardTitle><CardDescription>{period.label}</CardDescription></CardHeader>
    <CardContent className="space-y-2"><p className="text-2xl font-bold tabular-nums">{ready ? formatBRL(stats.total) : "—"}</p>{ready ? <><p className="text-xs text-muted-foreground">Fretes pagos atribuídos a este leilão, mesmo quando pagos depois.</p><p className="text-xs">{stats.paidCount} cliente(s) pagaram · {stats.pendingCount} pendente(s)</p>{stats.carriedCount > 0 && <p className="text-xs text-muted-foreground">{stats.carriedCount} cliente(s) já cobertos por frete pago em outro leilão.</p>}<p className="text-xs text-muted-foreground">Frete compartilhado entre leilões é contado uma única vez, no primeiro lote do pacote.</p></> : <p role="alert" className="text-sm text-muted-foreground">Não foi possível carregar os fretes. Atualize a página.</p>}</CardContent>
  </Card>;
}
