"use client";

import { useState } from "react";
import { CircleCheckIcon, TruckIcon } from "lucide-react";
import { FREIGHT_DAYS, type FreightDayKey } from "@/lib/freight";
import { formatBRL } from "@/lib/lots";
import type { AuctionPeriod } from "@/lib/auction-period";
import type { PeriodFreightStats } from "@/lib/dashboard-scope";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function FreightPeriodCard({ stats, period, ready }: {
  stats: PeriodFreightStats;
  period: AuctionPeriod;
  ready: boolean;
}) {
  const [day, setDay] = useState<FreightDayKey | null>(null);
  const value = day ? stats.byDay[day] : stats.total;
  const dayLabel = day ? FREIGHT_DAYS.find(entry => entry.key === day)?.label : null;

  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Frete do período</CardTitle>
        <TruckIcon className="size-4 shrink-0 text-muted-foreground" />
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-2">
        <p className="text-2xl font-bold tabular-nums">{ready ? formatBRL(value) : "—"}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{period.label}</p>
        <div className="grid grid-cols-7 gap-1 border-y py-2" aria-label="Filtrar fretes pelo dia do recebimento">
          {FREIGHT_DAYS.map(entry => (
            <Button key={entry.key} type="button" size="sm"
              variant={day === entry.key ? "default" : "outline"}
              aria-pressed={day === entry.key}
              aria-label={"Recebimentos de " + entry.label}
              className="h-8 min-w-0 px-0 text-[11px]" disabled={!ready}
              onClick={() => setDay(day === entry.key ? null : entry.key)}>
              {entry.label}
            </Button>
          ))}
        </div>
        {ready ? <>
          <p className="text-xs text-muted-foreground">{dayLabel ? "Fretes pagos de " + dayLabel + " no intervalo" : "Recebimentos pela data do pagamento"}</p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-emerald-600 dark:text-emerald-400">
            <CircleCheckIcon className="size-3.5 shrink-0" />
            <span>{stats.paidCount} {stats.paidCount === 1 ? "cliente pagou no intervalo" : "clientes pagaram no intervalo"}</span>
          </p>
          <p className="text-xs text-muted-foreground">{stats.pendingCount} cliente(s) com frete pendente nos lotes cadastrados.</p>
        </> : <p role="alert" className="text-sm text-muted-foreground">Não foi possível carregar os fretes. Atualize a página.</p>}
      </CardContent>
    </Card>
  );
}
