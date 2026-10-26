import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Coins,ArrowLeft } from 'lucide-react';
import { requireCustomer } from '@/lib/dal';
import { createClient } from '@/lib/supabase/server';
import { getCustomerCaracoinsBalance } from '@/lib/loyalty';
import { getCustomerCatalog,getCustomerHistory,getCoinHistory } from '@/lib/loyalty-history-server';
import { first,historyFilters,pageHref } from '@/lib/loyalty-history';
import { STORE_ORDER_COLUMNS } from '@/lib/store-server';
import { coinNumber,type StoreOrder } from '@/lib/store';
import { LoyaltyStorefront } from '@/components/client/loyalty-storefront';
import { StoreOrderCard } from '@/components/client/store-orders';
import { CustomerOrderHistory,customerOrderStages } from '@/components/client/customer-order-history';
import { CoinHistoryView } from '@/components/shared/coin-history';
import { HistoryPagination } from '@/components/shared/history-pagination';
import { Button } from '@/components/ui/button';
import { RetryButton } from '@/components/shared/retry-button';
export const metadata={title:'Loja dos Caras'};
const path='/painel/loja';
function Unavailable({label}:{label:string}){return <div role="alert" className="grid gap-3 rounded-xl border p-5 text-sm"><p>Não foi possível carregar {label}. Isso não significa que seu saldo ou histórico esteja vazio.</p><RetryButton/></div>;}
export default async function ClientStorePage({searchParams}:PageProps<'/painel/loja'>){
 const {customer}=await requireCustomer();const params=await searchParams;const tab=['orders','ledger'].includes(first(params.tab))?first(params.tab):'products';
 const filters=historyFilters(params);const db=await createClient();
 const [settings,balance]=await Promise.all([db.from('loyalty_settings').select('active').eq('id',true).single(),getCustomerCaracoinsBalance(customer.id)]);
 let content:React.ReactNode;
 if(tab==='orders'){
  const status=Object.hasOwn(customerOrderStages,first(params.status))?first(params.status):'all';
  const data=await getCustomerHistory(status,filters).catch(()=>null);
  if(data&&data.page!==filters.page)redirect(pageHref(path,params,data.page));
  content=data?<CustomerOrderHistory key={JSON.stringify(params)} data={data} status={status} filters={filters} params={{...params,tab:'orders'}}/>:<Unavailable label="seus pedidos"/>;
 }else if(tab==='ledger'){
  const data=await getCoinHistory(filters).catch(()=>null);
  if(data&&data.page!==filters.page)redirect(pageHref(path,params,data.page));
  content=data?<CoinHistoryView key={JSON.stringify(params)} data={data} filters={filters} params={{...params,tab:'ledger'}}/>:<Unavailable label="seu extrato"/>;
 }else{
  const mode=['coins','cash','mixed'].includes(first(params.mode))?first(params.mode):'';const sort=['cash','coins'].includes(first(params.sort))?first(params.sort):'newest';const category=first(params.category).slice(0,60);
  const [catalog,open]=await Promise.all([
   !settings.error&&settings.data?.active?getCustomerCatalog(filters.q,category,mode,sort,filters.page).catch(()=>null):Promise.resolve(null),
   db.from('store_orders').select(STORE_ORDER_COLUMNS).eq('customer_id',customer.id).in('payment_status',['creating','pending']).maybeSingle(),
  ]);
  if(catalog&&catalog.page!==filters.page)redirect(pageHref(path,params,catalog.page));
  content=<>{open.error?<Unavailable label="seu pedido em andamento"/>:open.data&&<StoreOrderCard order={open.data as unknown as StoreOrder}/>}
   {settings.error||balance===null?<Unavailable label="a loja e seu saldo"/>:!settings.data?.active?<p className="rounded-xl border p-5 text-sm text-muted-foreground">A loja está em preparação. Você pode acompanhar suas compras em Meus pedidos.</p>:!catalog||open.error?<Unavailable label="os produtos da loja"/>:<><LoyaltyStorefront rewards={catalog.items} balance={balance} customerId={customer.id} hasOpenOrder={!!open.data} catalog={catalog} catalogFilters={{q:filters.q,category,mode,sort}}/><HistoryPagination path={path} params={params} data={catalog}/></>}</>;
 }
 return <div className="grid min-w-0 gap-5"><header><Button asChild size="sm" variant="ghost" className="-ml-2"><Link href="/painel"><ArrowLeft/>Voltar ao painel</Link></Button><h1 className="mt-3 text-2xl font-bold">Loja dos Caras</h1><p className="mt-1 text-sm text-muted-foreground">Produtos, pedidos e suas Caracoins.</p></header>
 <div className="flex items-center gap-3 rounded-2xl border border-ouro/30 bg-amarelo/10 p-4"><Coins className="size-6 shrink-0 text-ouro-ink"/><div><p className="text-xs text-muted-foreground">Caracoins disponíveis</p><p className="mt-1 text-2xl font-bold text-ouro-ink">{balance===null?'Saldo indisponível':coinNumber(balance)}</p></div></div>
 <nav aria-label="Seções da loja" className="grid grid-cols-3 gap-1 rounded-xl border bg-card p-1">{([['products','Produtos'],['orders','Meus pedidos'],['ledger','Extrato']] as const).map(([key,label])=><Link key={key} href={`${path}?tab=${key}`} aria-current={tab===key?'page':undefined} className={`rounded-lg px-2 py-3 text-center text-xs font-semibold ${tab===key?'bg-amarelo/15 text-ouro-ink':'text-muted-foreground'}`}>{label}</Link>)}</nav>
 {content}</div>;
}
