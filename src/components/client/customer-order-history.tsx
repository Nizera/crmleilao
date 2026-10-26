import Link from 'next/link';
import { StoreOrderCard } from './store-orders';
import { HistoryPagination } from '@/components/shared/history-pagination';
import { coinDate,type CustomerOrders,type HistoryFilters } from '@/lib/loyalty-history';
import { priceLabel } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
export const customerOrderStages={all:'Todos',unpaid:'Pagamento pendente',preparing:'Em preparação',fulfilled:'Concluídos',closed:'Encerrados / análise'} as const;
export function CustomerOrderHistory({data,status,filters,params}:{data:CustomerOrders;status:string;filters:HistoryFilters;params:Record<string,string|string[]|undefined>}){
 return <section className="grid min-w-0 gap-4"><h2 className="text-xl font-semibold">Meus pedidos</h2><p className="text-xs text-muted-foreground">Compras da loja e resgates anteriores, no mesmo histórico.</p>
 <form action="/painel/loja" className="grid grid-cols-2 items-end gap-3"><input type="hidden" name="tab" value="orders"/><label className="col-span-2 grid gap-1 text-xs">Situação<select name="status" defaultValue={status} className="h-10 rounded-lg border bg-background px-3">{Object.entries(customerOrderStages).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label className="grid min-w-0 gap-1 text-xs">De<Input name="from" type="date" defaultValue={filters.from}/></label><label className="grid min-w-0 gap-1 text-xs">Até<Input name="to" type="date" defaultValue={filters.to}/></label><div className="col-span-2 flex gap-3"><Button size="sm">Filtrar</Button><Link href="/painel/loja?tab=orders" className="self-center text-xs underline">Limpar</Link></div></form>
 {data.items.length===0&&<p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhum pedido neste filtro.</p>}
 {data.items.map(o=>o.source==='store'?<StoreOrderCard key={o.id} order={o}/>:<article key={o.id} className="grid gap-2 rounded-xl border bg-card p-4"><div className="flex flex-wrap justify-between gap-2"><h3 className="text-sm font-semibold">{o.code}</h3><span className="text-xs text-muted-foreground">Resgate anterior</span></div><p className="text-xs text-muted-foreground">{coinDate(o.created_at)} · {o.legacy_status==='fulfilled'?'Concluído':o.legacy_status==='rejected'?'Cancelado · Caracoins devolvidas':o.legacy_status==='approved'?'Em separação':'Aguardando separação'}</p>{o.items.map(i=><p key={i.id} className="text-sm">{i.quantity}× {i.name}</p>)}<strong className="text-sm text-ouro-ink">{priceLabel(0,Number(o.coins_total))}</strong>{o.admin_note&&<p className="break-words text-xs text-muted-foreground">Equipe: {o.admin_note}</p>}</article>)}
 <HistoryPagination path="/painel/loja" params={params} data={data}/></section>;
}
