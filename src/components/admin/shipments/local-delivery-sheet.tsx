"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { loadShipmentContext, type ShipmentContext } from "@/app/actions/shipments";
import { createLocalDelivery } from "@/app/actions/local-deliveries";
import { shipmentContentSnapshot } from "@/lib/shipment-content";
import type { Shipment } from "@/lib/shipments";
import { formatBRL, formatDateBR } from "@/lib/lots";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

export function LocalDeliverySheet({ customerId, name, day, onClose, onCreated }: {
  customerId: string; name: string | null; day: string; onClose: () => void; onCreated: (shipment: Shipment) => void;
}) {
  const router = useRouter();
  const [context, setContext] = useState<ShipmentContext | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [requestId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    let active = true;
    void loadShipmentContext(customerId, day).then(result => {
      if (!active) return;
      if (!result.ok) { setError(result.error); return; }
      setContext(result.data); setSelected(result.data.lots.map(l => l.id));
    }).catch(() => { if (active) setError("Não foi possível carregar os itens. Feche e abra novamente."); });
    return () => { active = false; };
  }, [customerId, day]);
  const lots = context?.lots.filter(l => selected.includes(l.id)) ?? [];
  const count = lots.length + (context?.storeOrders.length ?? 0) + (context?.logisticsPending.length ?? 0);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!context || !count) return;
    setError(null);
    start(async () => {
      try {
        const result = await createLocalDelivery({ customerId, day, requestId, note,
          expected: shipmentContentSnapshot(lots, context.storeOrders, context.logisticsPending),
        });
        if (!result.ok) { setError(result.error); return; }
        toast.success("Saída por motoboy registrada. O frete pago foi utilizado neste pacote.");
        onCreated(result.data); router.refresh();
      } catch { setError("Não foi possível concluir. Confira a lista de envios antes de tentar novamente."); }
    });
  }
  return <Sheet open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <SheetContent className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
      <SheetHeader><SheetTitle>Registrar entrega por motoboy</SheetTitle><SheetDescription>{name ?? "Cliente"} · envio previsto em {formatDateBR(day)}</SheetDescription></SheetHeader>
      <form onSubmit={submit} className="grid min-w-0 gap-4 px-4 pb-6">
        {!context && !error && <p role="status">Conferindo itens e pagamentos…</p>}
        {context && <>
          <div className="rounded-lg border p-3 text-sm"><span className="font-medium">Endereço de entrega</span><p className="mt-1 break-words text-muted-foreground">{context.addressLine || "Preencha o endereço na ficha do cliente."}</p></div>
          <fieldset disabled={busy} className="grid gap-2"><legend className="mb-2 font-medium">Lotes desta entrega</legend>
            {context.lots.map(lot => <label key={lot.id} className="flex min-w-0 items-start gap-3 rounded-lg border p-3 text-sm"><input type="checkbox" className="mt-1" checked={selected.includes(lot.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, lot.id] : ids.filter(id => id !== lot.id))} /><span className="min-w-0 flex-1 break-words">{lot.code} · {lot.title}</span><span className="shrink-0">{formatBRL(lot.arremate_value)}</span></label>)}
            {!context.lots.length && <p className="text-sm text-muted-foreground">Nenhum lote disponível nesta data.</p>}
          </fieldset>
          {!!context.storeOrders.length && <div className="rounded-lg border p-3 text-sm"><p className="font-medium">Pedidos da loja incluídos</p>{context.storeOrders.map(o => <p key={o.id}>{o.code}</p>)}</div>}
          {!!context.logisticsPending.length && <div className="rounded-lg border p-3 text-sm"><p className="font-medium">Prêmios e pendências incluídos</p>{context.logisticsPending.map(p => <p key={p.id} className="break-words">{p.quantity} × {p.title}</p>)}</div>}
          <label className="grid gap-2 text-sm font-medium">Observação para o cliente (opcional)<textarea maxLength={500} value={note} disabled={busy} onChange={e => setNote(e.target.value)} className="min-h-24 w-full rounded-md border bg-background p-3 font-normal" placeholder="Ex.: entrega no período da tarde." /></label>
          <div className="rounded-lg bg-muted p-3 text-sm">Ao confirmar, os itens ficam em entrega e o frete já pago é utilizado neste pacote. Novos arremates poderão gerar uma nova cobrança de frete. Nenhuma etiqueta será emitida na SuperFrete.</div>
          {!!context.storeBlock && <p role="alert" className="text-sm text-destructive">{context.storeBlock}</p>}
        </>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" type="button" disabled={busy} onClick={onClose}>Voltar</Button><Button type="submit" disabled={busy || !context || !count || !!context?.storeBlock}>{busy ? "Registrando saída…" : "Confirmar saída"}</Button></div>
      </form>
    </SheetContent>
  </Sheet>;
}
