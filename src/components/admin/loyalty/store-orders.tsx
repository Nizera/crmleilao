"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronLeft, ChevronRight, Search, PackageCheck } from "lucide-react";
import { handleStoreOrderAction, syncAdminStoreOrderAction } from "@/app/actions/store";
import { handleLoyaltyRedemption } from "@/app/actions/loyalty";
import { orderHistoryHref, orderStages, ORDER_HISTORY_PATH, type OrderHistoryData, type OrderHistoryFilters, type HistoryOrder, type OrderStage } from "@/lib/order-history";
import { priceLabel, storePaymentLabels } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const createdDate = (value: string) => new Date(value).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo",dateStyle:"short",timeStyle:"short"});
export function AdminStoreOrders({ data,filters,canEdit }: { data: OrderHistoryData; filters: OrderHistoryFilters; canEdit: boolean }) {
  const href = (changes: Partial<OrderHistoryFilters>) => orderHistoryHref(filters,{page:1,...changes});
  return <section className="grid min-w-0 gap-4">
    <div className="rounded-xl border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
      <p><strong className="text-foreground">O pagamento é confirmado automaticamente.</strong> Aqui a equipe inicia a separação e marca a entrega/conclusão.</p>
      <p className="mt-1">Resgates anteriores ao carrinho também aparecem nesta lista, identificados como <strong>Resgate antigo</strong>. Os valores continuam independentes de lotes e fretes.</p>
    </div>
    <div className="grid grid-cols-3 gap-2 sm:gap-3">{([['to-fulfill','Para separar'],['processing','Em separação'],['review','Precisam de atenção']] as const).map(([key,label])=><Link key={key} href={href({status:key})} className="min-w-0 rounded-xl border bg-card p-3 transition-colors hover:bg-muted/50 sm:p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold">{data.counts[key]}</p></Link>)}</div>
    <div className="min-w-0 rounded-xl border bg-card">
      <nav aria-label="Etapas dos pedidos" className="flex overflow-x-auto border-b p-2">{Object.entries(orderStages).map(([key,label])=><Link key={key} href={href({status:key as OrderStage})} aria-current={filters.status===key ? 'page' : undefined} className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${filters.status===key ? 'bg-amarelo/15 text-ouro-ink' : 'text-muted-foreground hover:bg-muted'}`}>{label}<span className="rounded bg-muted px-1.5 py-0.5 text-xs tabular-nums">{data.counts[key as OrderStage]}</span></Link>)}</nav>
      <form key={orderHistoryHref(filters)} action={ORDER_HISTORY_PATH} className="grid grid-cols-2 items-end gap-3 border-b p-4 xl:grid-cols-[minmax(180px,1fr)_160px_140px_140px_90px_auto]">
        <input type="hidden" name="status" value={filters.status}/>
        <label className="col-span-2 grid min-w-0 gap-1 text-xs font-medium xl:col-span-1">Buscar pedido ou cliente<div className="relative"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"/><Input name="q" defaultValue={filters.q} maxLength={100} placeholder="Nome, telefone ou pedido" className="pl-8"/></div></label>
        <label className="grid gap-1 text-xs font-medium">Origem<select name="source" defaultValue={filters.source} className="h-9 min-w-0 rounded-lg border bg-background px-2 text-sm"><option value="all">Todas as origens</option><option value="store">Carrinho da loja</option><option value="legacy">Resgates antigos</option></select></label>
        <label className="grid min-w-0 gap-1 text-xs font-medium">De<Input name="from" type="date" defaultValue={filters.from}/></label>
        <label className="grid min-w-0 gap-1 text-xs font-medium">Até<Input name="to" type="date" defaultValue={filters.to} min={filters.from || undefined}/></label>
        <label className="grid gap-1 text-xs font-medium">Por página<select name="size" defaultValue={filters.size} className="h-9 rounded-lg border bg-background px-2 text-sm">{[10,20,50].map(size=><option key={size} value={size}>{size}</option>)}</select></label>
        <div className="flex h-9 items-center gap-2"><Button type="submit" size="sm">Filtrar</Button><Link href={ORDER_HISTORY_PATH} className="text-xs text-muted-foreground underline">Limpar</Link></div>
      </form>
      {data.items.length===0 ? <div className="grid justify-items-center gap-2 p-10 text-center"><PackageCheck className="size-7 text-muted-foreground"/><p className="font-medium">Nenhum pedido neste filtro</p><p className="text-sm text-muted-foreground">Altere a etapa, a origem, a busca ou o período.</p></div> : <div className="divide-y">{data.items.map(order=><OrderRow key={`${order.source}-${order.id}`} order={order} canEdit={canEdit} returnHref={orderHistoryHref(filters)}/>)}</div>}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t p-4 text-sm"><p className="text-muted-foreground">{data.total ? `${(data.page-1)*data.size+1}–${Math.min(data.page*data.size,data.total)}` : '0'} de {data.total} pedido(s)</p><div className="flex items-center gap-2"><Button asChild variant="outline" size="sm" disabled={data.page<=1}><Link href={orderHistoryHref(filters,{page:Math.max(1,data.page-1)})} aria-label="Página anterior" aria-disabled={data.page<=1} tabIndex={data.page<=1 ? -1 : undefined} className={data.page<=1 ? 'pointer-events-none opacity-40' : ''}><ChevronLeft className="size-4"/></Link></Button><span className="text-xs tabular-nums">Página {data.page} de {data.pages}</span><Button asChild variant="outline" size="sm" disabled={data.page>=data.pages}><Link href={orderHistoryHref(filters,{page:Math.min(data.pages,data.page+1)})} aria-label="Próxima página" aria-disabled={data.page>=data.pages} tabIndex={data.page>=data.pages ? -1 : undefined} className={data.page>=data.pages ? 'pointer-events-none opacity-40' : ''}><ChevronRight className="size-4"/></Link></Button></div></footer>
    </div>
    <p className="text-xs text-muted-foreground">Contagens consideram todos os pedidos que correspondem à busca, origem e período. O período usa o horário de Brasília.</p>
    {!canEdit && <p className="text-sm text-muted-foreground">Perfil somente leitura.</p>}
  </section>;
}

function OrderRow({order,canEdit,returnHref}:{order:HistoryOrder;canEdit:boolean;returnHref:string}) {
  const router=useRouter(); const [pending,startTransition]=useTransition();
  const submit=(form:FormData)=>startTransition(async()=>{
    try { const result=await handleStoreOrderAction(form); if(!result.ok) toast.error(result.error); else {toast.success("Pedido atualizado.");router.refresh();} }
    catch {toast.error("Não foi possível atualizar o pedido agora.");}
  });
  const actionable=order.payment_status==='paid' && order.fulfillment_status!=='fulfilled';
  return <details className="group">
    <summary className="grid cursor-pointer list-none items-center gap-3 p-4 hover:bg-muted/30 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_20px] [&::-webkit-details-marker]:hidden">
      <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{order.code}</span><span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{order.source==='legacy' ? 'Resgate antigo' : 'Loja'}</span></div><p className="mt-1 truncate text-sm">{order.customer_name || 'Cliente'}</p><p className="text-xs text-muted-foreground">{createdDate(order.created_at)}</p></div>
      <div className="min-w-0"><span className={`inline-block rounded-full px-2 py-1 text-xs font-medium ${order.stage==='review' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : order.stage==='fulfilled' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}>{orderStages[order.stage]}</span><p className="mt-1 truncate text-xs text-muted-foreground">{order.items.reduce((sum,item)=>sum+item.quantity,0)} item(ns) · {order.items[0]?.name}</p></div>
      <p className="text-sm font-semibold text-ouro-ink">{priceLabel(Number(order.cash_total),Number(order.coins_total))}</p><ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180"/>
    </summary>
    <div className="grid gap-3 border-t bg-muted/10 p-4">
      <p className="text-sm"><strong>Pagamento:</strong> {order.source==='legacy' && order.legacy_status==='rejected' ? 'Resgate recusado · Caracoins devolvidas' : storePaymentLabels[order.payment_status]}{order.source==='legacy' && order.legacy_status!=='rejected' ? ' · Caracoins debitadas no resgate' : ''}</p>
      <p className="text-xs text-muted-foreground">Cliente: {order.customer_name || 'Cliente'} · {order.customer_phone || 'Telefone não informado'}</p>
      <ul className="grid gap-2 rounded-lg border bg-card p-3 text-sm">{order.items.map(item=><li key={item.id} className="flex flex-wrap justify-between gap-2"><span>{item.quantity}× {item.name}</span><span className="text-muted-foreground">{priceLabel(Number(item.unit_cash),Number(item.unit_coins))} / unidade</span></li>)}</ul>
      {order.customer_note && <p className="break-words text-sm">Observação do cliente: {order.customer_note}</p>}
      {order.admin_note && <p className="break-words text-sm text-muted-foreground">Mensagem ao cliente: {order.admin_note}</p>}
      {order.stage==='review' && <p className="text-sm text-amber-700 dark:text-amber-300">Separação bloqueada: confira o pagamento ou estorno no Mercado Pago. Não libere o pedido antes de resolver a divergência.</p>}
      {canEdit && order.source==='store' && Number(order.cash_total)>0 && <Button disabled={pending} variant="outline" size="sm" className="w-fit" onClick={()=>startTransition(async()=>{try {const result=await syncAdminStoreOrderAction(order.id);if(!result.ok)toast.error(result.error);else {toast.success('Pagamento consultado.');router.refresh();}}catch{toast.error('Não foi possível consultar o pagamento.');}})}>Consultar pagamento no Mercado Pago</Button>}
      {canEdit && actionable && (order.source==='legacy' ? <form action={handleLoyaltyRedemption} className="flex flex-wrap gap-2"><input type="hidden" name="redemption_id" value={order.id}/><input type="hidden" name="return_query" value={returnHref.split('?')[1] || ''}/><Input name="admin_note" maxLength={500} defaultValue={order.admin_note ?? ''} placeholder="Mensagem ao cliente (opcional)" className="min-w-0 flex-1"/>{order.legacy_status==='pending' && <Button name="status" value="approved" variant="outline">Iniciar separação</Button>}<Button name="status" value="fulfilled">Marcar como concluído</Button><Button name="status" value="rejected" variant="destructive" onClick={event=>{if(!window.confirm('Cancelar este resgate e devolver as Caracoins e o item reservado?'))event.preventDefault();}}>Cancelar e devolver</Button></form> : <form action={submit} className="flex flex-wrap gap-2"><input type="hidden" name="order_id" value={order.id}/><Input name="note" maxLength={500} defaultValue={order.admin_note ?? ''} placeholder="Mensagem ao cliente (opcional)" className="min-w-0 flex-1"/>{order.fulfillment_status==='awaiting' && <Button disabled={pending} name="status" value="processing" variant="outline">Iniciar separação</Button>}<Button disabled={pending} name="status" value="fulfilled">Marcar como concluído</Button>{Number(order.cash_total)===0 && <Button disabled={pending} name="status" value="cancelled" variant="destructive" onClick={event=>{if(!window.confirm('Cancelar o pedido e devolver as Caracoins e os itens reservados?'))event.preventDefault();}}>Cancelar e devolver</Button>}</form>)}
      {order.source==='store' && Number(order.cash_total)>0 && order.payment_status==='paid' && <p className="text-xs text-muted-foreground">Para cancelar uma compra paga por Pix, faça a devolução integral no Mercado Pago. O webhook atualiza o pedido e devolve as Caracoins. Itens concluídos não retornam automaticamente ao estoque.</p>}
      {order.stage==='fulfilled' && <p className="text-sm text-muted-foreground">Este pedido já foi concluído. Nenhuma aprovação adicional é necessária.</p>}
    </div>
  </details>;
}
