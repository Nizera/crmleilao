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
  receivedOn: number;
  paidLotsOn: number;
  staffPaid: number;
  staffTotal: number;
};

type Props = {
  closing: ClosingStats;
  ready: boolean;
  /** Data civil (SP) do card — abre o sheet já nela. */
  date: string;
  dateLabel: string;
};

export function ClosingCard({ closing, ready, date, dateLabel }: Props) {
  const [open, setOpen] = useState(false);

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
              {ready ? formatBRL(closing.receivedOn) : "—"}
            </div>
            <p className="text-xs text-muted-foreground">
              {ready
                ? `recebido em ${dateLabel} · ${
                    closing.paidLotsOn === 1
                      ? "1 lote pago"
                      : `${closing.paidLotsOn} lotes pagos`
                  }`
                : "aplique a migração 0016_staff_payments.sql"}
            </p>
            {ready && closing.staffTotal > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Equipe: {closing.staffPaid} {closing.staffPaid === 1
                  ? "pagamento registrado"
                  : "pagamentos registrados"}
              </p>
            )}
          </div>
          <Button onClick={() => setOpen(true)} disabled={!ready}>
            Abrir fechamento
          </Button>
        </CardContent>
      </Card>

      <ClosingSheet open={open} onOpenChange={setOpen} initialDate={date} />
    </>
  );
}
