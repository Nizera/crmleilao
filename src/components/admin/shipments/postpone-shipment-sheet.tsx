"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { postponeCustomerShipping } from "@/app/actions/shipment-postponement";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateBR, nextShippingDate } from "@/lib/lots";
import { isoDayAdd, spToday } from "@/lib/dates";

export function PostponeShipmentSheet({ customerId, name, from, onClose }: {
  customerId: string; name: string | null; from: string; onClose: () => void;
}) {
  const router = useRouter();
  const today = spToday();
  const minimum = from >= today ? isoDayAdd(from, 1) : today;
  const [to, setTo] = useState(() => nextShippingDate(from >= today ? from : isoDayAdd(today, -1)));
  const [includeLogistics, setIncludeLogistics] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  function submit(event: FormEvent) {
    event.preventDefault(); setError(null);
    start(async () => {
      try {
        const result = await postponeCustomerShipping({ customerId, from, to, includeLogistics });
        if (!result.ok) { setError(result.error); return; }
        toast.success(`Envio adiado para ${formatDateBR(to)}: ${result.data.lots} lote(s) e ${result.data.logistics} prêmio(s)/pendência(s).`);
        onClose(); router.refresh();
      } catch { setError("Não foi possível confirmar o adiamento. Atualize a tela antes de tentar novamente."); }
    });
  }
  return <Sheet open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <SheetContent className="w-full overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
      <SheetHeader><SheetTitle>Adiar envio</SheetTitle><SheetDescription>{name ?? "Cliente"} · envio de {formatDateBR(from)}</SheetDescription></SheetHeader>
      <form onSubmit={submit} className="grid gap-5 px-4 pb-6">
        <label className="grid gap-2 font-medium">Nova data de envio<Input type="date" value={to} min={minimum} required disabled={busy} onChange={(e) => setTo(e.target.value)} /></label>
        <p className="text-sm text-muted-foreground">Todos os lotes pagos ou aguardando pagamento desta data, ainda sem etiqueta, serão adiados.</p>
        <label className="flex items-start gap-3 rounded-lg border p-3 text-sm"><input type="checkbox" checked={includeLogistics} disabled={busy} onChange={(e) => setIncludeLogistics(e.target.checked)} className="mt-1" /><span>Adiar também os prêmios de rifa e pendências logísticas desta data, ainda sem etiqueta.</span></label>
        <div className="rounded-lg bg-muted p-3 text-sm">Pagamentos, frete pago e separações realizadas serão preservados. O prazo de 24 horas para pagamento não será renovado. Pedidos da loja não são alterados.</div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Voltar</Button><Button type="submit" disabled={busy || !to || to < minimum}>{busy ? "Adiando…" : "Confirmar adiamento"}</Button></div>
      </form>
    </SheetContent>
  </Sheet>;
}
