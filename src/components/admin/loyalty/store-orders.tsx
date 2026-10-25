"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { handleStoreOrderAction, syncAdminStoreOrderAction } from "@/app/actions/store";
import type { AdminStoreOrder } from "@/lib/store-server";
import { coinNumber, priceLabel, storeBRL, storePaymentLabels, storeFulfillmentLabels } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AdminStoreOrders({ orders, canEdit }: { orders: AdminStoreOrder[]; canEdit: boolean }) {
  const router = useRouter();
  const [filter, setFilter] = useState("to-fulfill");
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const filtered = orders.filter((order) => {
    const statusMatches = filter === "all" || (filter === "to-fulfill" ? order.payment_status === "paid" && order.fulfillment_status !== "fulfilled" : filter === "unpaid" ? ["creating","pending"].includes(order.payment_status) : filter === "review" ? ["partially_refunded","payment_review"].includes(order.payment_status) : order.fulfillment_status === "fulfilled");
    return statusMatches && `${order.code} ${order.customer?.name ?? ""} ${order.customer?.phone_e164 ?? ""}`.toLowerCase().includes(query.toLowerCase());
  });
  const paid = orders.filter((order) => order.payment_status === "paid");
  const submit = (form: FormData) => startTransition(async () => {
    try { const result = await handleStoreOrderAction(form); if (!result.ok) toast.error(result.error); else { toast.success("Pedido atualizado."); router.refresh(); } }
    catch { toast.error("Não foi possível atualizar o pedido agora."); }
  });
  return <section className="grid gap-4"><header><h2 className="text-xl font-semibold">Pedidos da loja</h2><p className="text-sm text-muted-foreground">Separe somente pedidos com pagamento confirmado. Valores da loja são independentes dos lotes e fretes.</p></header>
    <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Para separar</p><p className="mt-1 text-xl font-bold">{paid.filter((o) => o.fulfillment_status !== "fulfilled").length}</p></div><div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Reais recebidos · últimos pedidos</p><p className="mt-1 text-xl font-bold">{storeBRL(paid.reduce((sum,o) => sum + Number(o.cash_total),0))}</p></div><div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Caracoins utilizadas · últimos pedidos</p><p className="mt-1 text-xl font-bold">{coinNumber(paid.reduce((sum,o) => sum + Number(o.coins_total),0))}</p></div></div>
    <div className="flex flex-wrap gap-2"><select aria-label="Filtrar pedidos" value={filter} onChange={(event) => setFilter(event.target.value)} className="rounded-lg border bg-background p-2 text-sm"><option value="to-fulfill">Pagos para separar</option><option value="unpaid">Aguardando pagamento</option><option value="review">Devolução parcial</option><option value="fulfilled">Concluídos</option><option value="all">Todos os pedidos</option></select><Input placeholder="Buscar cliente, telefone ou pedido" aria-label="Buscar pedidos da loja" value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1" /></div>
    {filtered.length === 0 && <p className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">Nenhum pedido neste filtro.</p>}
    {filtered.map((order) => <article key={order.id} className="grid gap-3 rounded-xl border bg-card p-4"><div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-bold">{order.code} · {order.customer?.name ?? "Cliente"}</h3><p className="text-xs text-muted-foreground">{order.customer?.phone_e164} · {new Date(order.created_at).toLocaleString("pt-BR")}</p><p className="mt-1 text-sm">{storePaymentLabels[order.payment_status]}{order.payment_status === "paid" ? ` · ${storeFulfillmentLabels[order.fulfillment_status]}` : ""}</p></div><p className="font-bold text-ouro-ink">{priceLabel(Number(order.cash_total),Number(order.coins_total))}</p></div>
      <ul className="grid gap-1 text-sm">{order.items.map((item) => <li key={item.id}>{item.quantity}× {item.name} <span className="text-muted-foreground">· {priceLabel(Number(item.unit_cash),Number(item.unit_coins))} / unidade</span></li>)}</ul>
      {order.admin_note && <p className="text-sm text-muted-foreground">Mensagem ao cliente: {order.admin_note}</p>}
      {canEdit && Number(order.cash_total) > 0 && <Button disabled={pending} variant="outline" size="sm" className="w-fit" onClick={() => startTransition(async () => { try { const result = await syncAdminStoreOrderAction(order.id); if (!result.ok) toast.error(result.error); else { toast.success("Pagamento consultado."); router.refresh(); } } catch { toast.error("Não foi possível consultar o pagamento."); } })}>Consultar pagamento no Mercado Pago</Button>}
      {order.payment_status === "partially_refunded" && <p className="text-sm text-amber-600">Devolução parcial detectada: a separação está bloqueada. Confira o caso no Mercado Pago; Caracoins e estoque só são devolvidos automaticamente após devolução integral.</p>}
      {order.payment_status === "payment_review" && <p className="text-sm text-amber-600">Pagamento recebido após o encerramento do pedido. As reservas já foram liberadas; não separe este pedido automaticamente. Confira a devolução integral no Mercado Pago antes de orientar uma nova compra.</p>}
      {canEdit && order.payment_status === "paid" && order.fulfillment_status !== "fulfilled" && <form action={submit} className="flex flex-wrap gap-2"><input type="hidden" name="order_id" value={order.id} /><Input name="note" maxLength={500} placeholder="Mensagem ao cliente (opcional)" defaultValue={order.admin_note ?? ""} className="min-w-0 flex-1" /><Button disabled={pending} name="status" value="processing" variant="outline">Separar</Button><Button disabled={pending} name="status" value="fulfilled">Concluir</Button>{Number(order.cash_total) === 0 && <Button disabled={pending} name="status" value="cancelled" variant="destructive" onClick={(event) => { if (!window.confirm("Cancelar o pedido e devolver todas as Caracoins e os itens reservados?")) event.preventDefault(); }}>Cancelar e devolver</Button>}</form>}
      {canEdit && order.payment_status === "paid" && Number(order.cash_total) > 0 && <p className="text-xs text-muted-foreground">Para cancelar uma compra paga por Pix, faça a devolução integral no Mercado Pago. O webhook atualiza o pedido e devolve as Caracoins. Itens já concluídos não retornam automaticamente ao estoque.</p>}
    </article>)}
    <p className="text-xs text-muted-foreground">Exibindo até 100 pedidos recentes. Indicadores se referem somente a esta lista.</p>
  </section>;
}
