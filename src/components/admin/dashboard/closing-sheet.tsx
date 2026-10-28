"use client";
import { useEffect, useMemo, useState } from "react";
import { CopyIcon, MessageCircleIcon, RefreshCcwIcon } from "lucide-react";
import { toast } from "sonner";
import { getClosingDataAction } from "@/app/actions/staff-payments";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatBRL, formatDateBR, waMessageLink, waShareLink } from "@/lib/lots";
import { spDayOf, spTimeOf } from "@/lib/dates";
import type { AuctionPeriod } from "@/lib/auction-period";
import type { ClosingData } from "@/lib/staff-payments";

type Props = { open: boolean; onOpenChange: (open: boolean) => void; period: AuctionPeriod };
export function ClosingSheet({ open, onOpenChange, period }: Props) {
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl"><SheetHeader className="border-b px-6 py-4"><SheetTitle>Fechamento do leilão</SheetTitle><SheetDescription>{period.label} · São Paulo. Lotes selecionados pela data e hora do cadastro.</SheetDescription></SheetHeader>{open && <ClosingPanel key={period.from + period.to} period={period} />}</SheetContent></Sheet>;
}
function ClosingPanel({ period }: { period: AuctionPeriod }) {
  const [data, setData] = useState<ClosingData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [loadedRevision, setLoadedRevision] = useState(-1);
  const loading = loadedRevision !== revision;
  useEffect(() => {
    let cancelled = false;
    getClosingDataAction(period.day, { from: period.from, to: period.to }).then(result => {
      if (cancelled) return;
      if (result.ok) { setData(result.data); setError(null); } else setError(result.error);
      setLoadedRevision(revision);
    }).catch(() => { if (!cancelled) { setError("Não foi possível carregar. Tente atualizar."); setLoadedRevision(revision); } });
    return () => { cancelled = true; };
  }, [period.day, period.from, period.to, revision]);
  const summary = useMemo(() => data ? [
    "Fechamento do leilão", data.period.label + " (São Paulo)",
    "Lotes cadastrados: " + data.totalLots + " — " + formatBRL(data.registeredOn),
    "Recebido desses lotes: " + formatBRL(data.receivedOn) + " (" + data.paidLotsOn + " lote(s))",
    "Pendente desses lotes: " + formatBRL(data.periodPendingTotal) + " (" + data.periodPendingCount + " lote(s))",
    "Lotes cancelados e valores de frete não entram nestes totais.",
    "Pix abertos dos lotes do período: " + data.pendingCharges.length + " — " + formatBRL(data.pendingTotal) + " (somente os lotes deste período)",
    "", "Lotes pendentes deste período: " + data.pendingLots.length,
    ...data.pendingLots.map(lot => "• " + lot.code + " — " + lot.customerName + " — " + lot.title + " — " + formatBRL(lot.amount)),
  ].join("\n") : "", [data]);
  return <>
    <div className="flex flex-wrap items-center justify-between gap-2 border-b px-6 py-3"><p className="text-xs text-muted-foreground">Para mudar o período, use o filtro do dashboard.</p><Button size="sm" variant="ghost" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCcwIcon className={loading ? "animate-spin" : ""} />Atualizar</Button></div>
    {error && <p role="alert" className="m-6 text-sm text-destructive">{error}</p>}
    {loading && <p className="px-6 py-4 text-sm text-muted-foreground">Carregando…</p>}
    {data && <>
      <section className="grid grid-cols-1 gap-3 border-b px-6 py-4 sm:grid-cols-3">{[
        ["Total cadastrado", data.registeredOn, data.totalLots],
        ["Já recebido", data.receivedOn, data.paidLotsOn],
        ["Ainda pendente", data.periodPendingTotal, data.periodPendingCount],
      ].map(([label, value, count]) => <div key={label} className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold">{formatBRL(Number(value))}</p><p className="text-xs text-muted-foreground">{count} lote(s)</p></div>)}</section>
      <section className="border-b px-6 py-4"><h3 className="font-semibold">Lotes do período</h3><p className="mb-3 text-xs text-muted-foreground">Valores só dos lotes, sem frete. Recebimentos posteriores também aparecem após a confirmação.</p>{data.entries.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum lote cadastrado nesse período.</p> : <ul className="space-y-3">{data.entries.map(entry => <li key={entry.code} className="flex flex-wrap justify-between gap-2 rounded-lg border p-3 text-sm"><div className="min-w-0"><p className="font-medium">{entry.code} · {entry.customer}</p><p className="break-words text-muted-foreground">{entry.title}</p><p className="text-xs text-muted-foreground">Cadastro: {formatDateBR(spDayOf(entry.createdAt))} às {spTimeOf(entry.createdAt)}</p></div><div className="text-right"><p className="font-semibold">{formatBRL(entry.value)}</p><p className="text-xs text-muted-foreground">{entry.status === "pending_payment" ? "Aguardando pagamento" : entry.paidAt ? "Pago" : "Sem confirmação de pagamento"}</p></div></li>)}</ul>}</section>
      <section className="border-b px-6 py-4"><h3 className="font-semibold">Pix abertos — lotes do período</h3><p className="mb-3 text-xs text-muted-foreground">Os valores abaixo são somente dos lotes selecionados. O Pix completo pode incluir outros leilões e frete.</p>{data.pendingCharges.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma cobrança aberta.</p> : <ul className="space-y-2">{data.pendingCharges.map(charge => <li key={charge.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"><div><p className="font-medium">{charge.customerName ?? "Sem nome"} · {charge.code}</p><p>{formatBRL(charge.amount)}</p></div>{charge.phone_e164 && <Button size="sm" variant="outline" asChild><a href={waMessageLink(charge.phone_e164, "Olá! Seus lotes deste leilão têm o valor pendente de " + formatBRL(charge.amount) + ". Confira o valor total do Pix e pague pelo painel." + (charge.ticketUrl ? " Pix: " + charge.ticketUrl : ""))} target="_blank" rel="noopener noreferrer"><MessageCircleIcon />Cobrar</a></Button>}</li>)}</ul>}</section>
      <section className="px-6 py-4"><h3 className="font-semibold">Resumo para copiar ou compartilhar</h3><pre className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/30 p-3 text-xs">{summary}</pre><div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" disabled={loading || !!error} onClick={() => { void navigator.clipboard.writeText(summary).then(() => toast.success("Resumo copiado.")).catch(() => toast.error("Não foi possível copiar.")); }}><CopyIcon />Copiar resumo</Button><Button variant="outline" disabled={loading || !!error} onClick={() => window.open(waShareLink(summary), "_blank", "noopener,noreferrer")}><MessageCircleIcon />WhatsApp</Button></div></section>
    </>}
  </>;
}
