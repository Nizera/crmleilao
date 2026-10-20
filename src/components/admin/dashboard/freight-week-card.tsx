"use client";

import { useState } from "react";
import { CircleCheckIcon, TruckIcon } from "lucide-react";

import {
  FREIGHT_DAYS,
  type FreightDayKey,
  type FreightWeekStats,
} from "@/lib/freight";
import { formatBRL, formatDateBR } from "@/lib/lots";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Frete da semana: total recebido no período (terça→terça) com filtro por
 * dia da semana. Sem filtro = período inteiro; com dia = só o total do dia.
 */
export function FreightWeekCard({ stats }: { stats: FreightWeekStats }) {
  const [day, setDay] = useState<FreightDayKey | null>(null);

  const value = day ? stats.byDay[day] : stats.total;
  const dayLabel = day
    ? (FREIGHT_DAYS.find((entry) => entry.key === day)?.label ?? day)
    : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <TruckIcon className="size-4 text-muted-foreground" />
            Frete da semana
          </CardTitle>
          <CardDescription>
            {formatDateBR(stats.periodStart)} → {formatDateBR(stats.periodEnd)}
          </CardDescription>
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          {FREIGHT_DAYS.map((entry) => (
            <Button
              key={entry.key}
              type="button"
              size="sm"
              variant={day === entry.key ? "default" : "outline"}
              className="h-7 px-2 text-xs"
              onClick={() => setDay(day === entry.key ? null : entry.key)}
            >
              {entry.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        <p className="text-2xl font-bold tabular-nums">{formatBRL(value)}</p>
        <p className="text-xs text-muted-foreground">
          {dayLabel
            ? `recebido de ${dayLabel} no período`
            : "recebido no período"}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-emerald-600 dark:text-emerald-400">
          <CircleCheckIcon className="size-3.5 shrink-0" />
          <span>
            {stats.paidCount}{" "}
            {stats.paidCount === 1 ? "cliente pagou" : "clientes pagaram"}
            {stats.pendingCount > 0
              ? ` · ${stats.pendingCount} pendente(s)`
              : " · nenhum pendente"}
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
