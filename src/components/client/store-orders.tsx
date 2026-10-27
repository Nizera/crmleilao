"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { CheckCircle2, Copy, Loader2, Package, QrCode, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cancelSelfStoreOrderAction, syncSelfStoreOrderAction } from "@/app/actions/store";
import { isStoreOrderOpen, priceLabel, safePixTicketUrl, storeFulfillmentLabels, storePaymentLabels, type StoreOrder } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export function StoreOrderCard({ order }: { order: StoreOrder }) {
  const router = useRouter();
  const [showPix, setShowPix] = useState(false);
  const [expiredLocally, setExpiredLocally] = useState(false);
  const [pending, startTransition] = useTransition();
  const checking = useRef(false);
  const active = isStoreOrderOpen(order);
  const ticket = safePixTicketUrl(order.ticket_url);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    const sync = async () => {
      if (checking.current || document.visibilityState !== "visible") return;
      checking.current = true;
      try {
        const result = await syncSelfStoreOrderAction(order.id);
        if (!disposed && result.ok && (result.data.payment_status !== order.payment_status || result.data.qr_code !== order.qr_code)) {
          if (result.data.payment_status === "paid") toast.success("Pagamento confirmado! A equipe já pode separar seu pedido.");
          else if (!isStoreOrderOpen(result.data)) toast.info(storePaymentLabels[result.data.payment_status]);
          router.refresh();
        }
      } catch { /* O webhook continua disponível. A consulta será repetida. */ }
      finally { checking.current = false; }
    };
    void sync();
    const timer = setInterval(() => void sync(), 15000);
    document.addEventListener("visibilitychange", sync);
    return () => { disposed = true; clearInterval(timer); document.removeEventListener("visibilitychange", sync); };
  }, [active, order.id, order.payment_status, order.qr_code, router]);
  const update = (cancel = false) => startTransition(async () => {
    try {
      const result = await (cancel ? cancelSelfStoreOrderAction(order.id) : syncSelfStoreOrderAction(order.id));
      if (!result.ok) { toast.error(result.error); return; }
      toast.success(storePaymentLabels[result.data.payment_status]);
      router.refresh();
    } catch { toast.error("Não foi possível consultar agora. Tente novamente em instantes."); }
  });
  return <article className={`rounded-xl border p-4 ${active ? "border-ouro/40 bg-amarelo/5" : "bg-card"}`}>
    <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="flex items-center gap-2 text-sm font-semibold">{order.payment_status === "paid" ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Package className="size-4" />} Pedido {order.code}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(order.created_at).toLocaleDateString("pt-BR",{timeZone:"America/Sao_Paulo"})} · {storePaymentLabels[order.payment_status]}</p>{order.payment_status === "paid" && <p className="mt-1 text-xs font-semibold text-ouro-ink">{storeFulfillmentLabels[order.fulfillment_status]}</p>}</div><p className="text-sm font-bold text-ouro-ink">{priceLabel(Number(order.cash_total),Number(order.coins_total))}</p></div>
    <details className="mt-3" open={active}><summary className="cursor-pointer text-sm font-medium">Ver itens do pedido ({order.items.reduce((sum,item)=>sum+item.quantity,0)})</summary><ul className="mt-2 space-y-1 text-sm">{order.items.map((item) => <li key={item.id}>{item.quantity}× {item.name}</li>)}</ul></details>
    {order.payment_status==='paid' && order.boxed_at && !order.shipment_id && <p className="mt-2 text-sm">Separado na sua caixa, aguardando envio junto dos seus lotes. Sem lotes ou frete disponível, a equipe combinará o envio com você.</p>}
    {order.shipment && <p className="mt-2 text-sm">Envio {order.shipment.code}{order.shipment.tracking_code ? ` · Rastreio ${order.shipment.tracking_code}` : ''} · <Link href="/painel/envios" className="font-medium underline">Acompanhar envio</Link></p>}
    {order.admin_note && <p className="mt-2 text-xs text-muted-foreground">Equipe: {order.admin_note}</p>}
    {active && <><p className="mt-3 text-xs text-muted-foreground">A confirmação do Pix aparece automaticamente aqui. Os itens e as Caracoins estão reservados.</p><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" onClick={() => { setExpiredLocally(order.expires_at !== null && new Date(order.expires_at).getTime() < Date.now()); if (!order.qr_code && !order.ticket_url) update(); setShowPix(true); }}><QrCode />{order.payment_status === "creating" ? "Preparar pagamento" : "Pagar Pix"}</Button><Button size="sm" variant="outline" disabled={pending} onClick={() => update()}><RefreshCw className={pending ? "animate-spin" : ""} />Atualizar</Button><Button size="sm" variant="ghost" disabled={pending} onClick={() => { if (window.confirm("Cancelar este Pix e devolver as Caracoins reservadas?")) update(true); }}>Cancelar pedido</Button></div></>}
    <Sheet open={showPix && active} onOpenChange={setShowPix}><SheetContent className="overflow-y-auto data-[side=right]:w-full"><SheetHeader><SheetTitle>Pix do pedido {order.code}</SheetTitle><SheetDescription>{priceLabel(Number(order.cash_total),Number(order.coins_total))}. A confirmação será automática.</SheetDescription></SheetHeader><div className="grid gap-4 p-4">
      {expiredLocally ? <p className="text-sm">O prazo deste Pix terminou. Estamos verificando o encerramento para devolver sua reserva.</p> : order.qr_code ? <>
        {order.qr_code_base64 && <div className="flex justify-center"><Image alt="QR Code Pix do pedido" src={`data:image/png;base64,${order.qr_code_base64}`} width={224} height={224} unoptimized className="size-56 rounded-xl bg-white p-2" /></div>}
        <label className="grid gap-2 text-sm">Pix copia e cola<textarea readOnly value={order.qr_code} rows={4} className="w-full resize-none rounded-lg border bg-muted p-3 text-xs" onFocus={(event) => event.target.select()} /></label><Button onClick={async () => { try { await navigator.clipboard.writeText(order.qr_code!); toast.success("Pix copiado!"); } catch { toast.error("Selecione e copie o código acima."); } }}><Copy /> Copiar código Pix</Button>
      </> : ticket ? <Button asChild><a href={ticket} target="_blank" rel="noopener noreferrer">Abrir pagamento no Mercado Pago</a></Button> : <p className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" />Preparando seu Pix. Seu pedido já está salvo.</p>}
      <Button variant="outline" disabled={pending} onClick={() => update()}><RefreshCw /> Verificar pagamento</Button><p className="text-xs text-muted-foreground">Você pode fechar esta tela. O pedido continuará disponível na loja.</p>
    </div></SheetContent></Sheet>
  </article>;
}
