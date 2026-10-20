"use client";

import { useState } from "react";
import { CalendarCheckIcon } from "lucide-react";

import { ClosingSheet } from "@/components/admin/dashboard/closing-sheet";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatBRL } from "@/lib/lots";

type ClosingStats = {
  receivedToday: number;
  paidLotsToday: number;
  staffPaid: number;
  staffTotal: number;
};

type Props = {
  closing: ClosingStats;
  ready: boolean;
  dateLabel: string;
};

export function ClosingCard({ closing, ready, dateLabel }: Props) {
  const [open, setOpen] = useState(false);

  const pendingCount = Math.max(closing.staffTotal - closing.staffPaid, 0);
  const fullyPaid = ready && closing.staffTotal > 0 && pendingCount === 0;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Fechamento do dia
          </CardTitle>
          <CalendarCheckIcon className="size-4 text-muted-foreground" />
        </CardHeader>
        <CardContent className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-2xl font-bold tabular-nums">
              {ready ? formatBRL(closing.receivedToday) : "—"}
            </div>
            <p className="text-xs text-muted-foreground">
              {ready
                ? `recebido em ${dateLabel} · ${
                    closing.paidLotsToday === 1
                      ? "1 lote pago"
                      : `${closing.paidLotsToday} lotes pagos`
                  }`
                : "aplique a migração 0016_staff_payments.sql"}
            </p>
            {ready && closing.staffTotal > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Pagamentos: {closing.staffPaid} de {closing.staffTotal}
                {fullyPaid
                  ? " · tudo pago"
                  : pendingCount > 0
                    ? ` · falta ${pendingCount}`
                    : ""}
              </p>
            )}
          </div>
          <Button onClick={() => setOpen(true)} disabled={!ready}>
            {fullyPaid ? "Ver fechamento" : "Abrir fechamento"}
          </Button>
        </CardContent>
      </Card>

      <ClosingSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
