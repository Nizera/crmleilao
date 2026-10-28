"use client";

import { useState } from "react";
import { CircleCheckIcon, TruckIcon } from "lucide-react";
import { FREIGHT_DAYS, type FreightDayKey } from "@/lib/freight";
import { formatBRL } from "@/lib/lots";
import type { AuctionPeriod } from "@/lib/auction-period";
import type { PeriodFreightStats } from "@/lib/dashboard-scope";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export function FreightPeriodCard({ stats, period, ready }: {
  stats: PeriodFreightStats;
  period: AuctionPeriod;
  ready: boolean;
}) {
  const [day, setDay] = useState<FreightDayKey | null>(null);
  const value = day ? stats.byDay[day] : stats.total;
  const dayLabel = day ? FREIGHT_DAYS.find(entry => entry.key === day)?.label : null;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3 space-y-0 pb-3 sm:flex-row sm:flex-nowrap">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <TruckIcon className="size-4 shrink-0 text-muted-foreground" />
            Frete do período
          </CardTitle>
          <CardDescription className="mt-1">{period.label}</CardDescription>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1 sm:max-w-64" aria-label="Filtrar fretes pelo dia do recebimento">
          {FREIGHT_DAYS.map(entry => (
            <Button key={entry.key} type="button" size="sm"
              variant={day === entry.key ? "default" : "outline"}
              aria-pressed={day === entry.key}
              aria-label={"Recebimentos de " + entry.label}
              className="h-7 px-2 text-xs" disabled={!ready}
              onClick={() => setDay(day === entry.key ? null : entry.key)}>
              {entry.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        <p className="text-2xl font-bold tabular-nums">{ready ? formatBRL(value) : "—"}</p>
        {ready ? <>
          <p className="text-xs text-muted-foreground">{dayLabel ? "Recebido de " + dayLabel + " · lotes do período filtrado" : "Recebido pelos fretes dos lotes filtrados"}</p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-emerald-600 dark:text-emerald-400">
            <CircleCheckIcon className="size-3.5 shrink-0" />
            <span>{stats.paidCount} {stats.paidCount === 1 ? "cliente pagou" : "clientes pagaram"}{stats.pendingCount > 0 ? " · " + stats.pendingCount + " pendente(s)" : " · nenhum pendente"}</span>
          </p>
          {stats.carriedCount > 0 && <p className="text-xs text-muted-foreground">{stats.carriedCount} cliente(s) já cobertos por frete de outro leilão.</p>}
        </> : <p role="alert" className="text-sm text-muted-foreground">Não foi possível carregar os fretes. Atualize a página.</p>}
      </CardContent>
    </Card>
  );
}
