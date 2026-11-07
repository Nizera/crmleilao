"use client";
import { FinancialValue } from "@/components/admin/financial-privacy";
import { useState } from "react";
import { CalendarCheckIcon } from "lucide-react";
import { ClosingSheet } from "@/components/admin/dashboard/closing-sheet";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBRL } from "@/lib/lots";
import type { AuctionPeriod } from "@/lib/auction-period";

type Props = {
  closing: { receivedOn: number; paidLotsOn: number };
  ready: boolean;
  period: AuctionPeriod;
};
export function ClosingCard({ closing, ready, period }: Props) {
  const [open, setOpen] = useState(false);
  return <><Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Fechamento do período</CardTitle><CalendarCheckIcon className="size-4 text-muted-foreground" /></CardHeader>
    <CardContent className="flex flex-wrap items-end justify-between gap-3"><div><div className="text-2xl font-bold tabular-nums"><FinancialValue>{ready ? formatBRL(closing.receivedOn) : "—"}</FinancialValue></div><p className="text-xs text-muted-foreground">Lotes pagos neste intervalo · {closing.paidLotsOn} lote(s)</p><p className="mt-1 text-xs text-muted-foreground">{period.label}</p></div><Button onClick={() => setOpen(true)} disabled={!ready}>Abrir fechamento</Button></CardContent></Card>
    <ClosingSheet open={open} onOpenChange={setOpen} period={period} />
  </>;
}
