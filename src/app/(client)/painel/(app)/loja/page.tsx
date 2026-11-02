import Link from 'next/link';
import {storePurchasesEnabled} from '@/lib/store-settings-server';
import {catalogFiltersFrom,type StoreBanner} from '@/lib/store-presentation';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { requireCustomer } from '@/lib/dal';
import { createClient } from '@/lib/supabase/server';
import { getCustomerCaracoinsBalance } from '@/lib/loyalty';
import { getCustomerCatalog,getCustomerHistory,getCoinHistory } from '@/lib/loyalty-history-server';
import { first,historyFilters,pageHref } from '@/lib/loyalty-history';
import { STORE_ORDER_COLUMNS } from '@/lib/store-server';
import { type StoreOrder } from '@/lib/store';
import {StoreVouchers} from '@/components/client/store-vouchers';
import type {CustomerVoucher,VoucherTemplate} from '@/lib/store-vouchers';
import { StoreSearch } from '@/components/client/store-search';
import { LoyaltyStorefront } from '@/components/client/loyalty-storefront';
import { StoreOrderCard } from '@/components/client/store-orders';
import { CustomerOrderHistory,customerOrderStages } from '@/components/client/customer-order-history';
import { CoinHistoryView } from '@/components/shared/coin-history';
import { HistoryPagination } from '@/components/shared/history-pagination';
import { Button } from '@/components/ui/button';
import { RetryButton } from '@/components/shared/retry-button';
export const metadata={title:'Loja dos Caras'};
export const instant=false;
const path='/painel/loja';
function Unavailable({label}:{label:string}){return <div role="alert" className="grid gap-3 rounded-xl border p-5 text-sm"><p>Não foi possível carregar {label}. Isso não significa que seu saldo ou histórico esteja vazio.</p><RetryButton/></div>;}
export default async function ClientStorePage({searchParams}:PageProps<'/painel/loja'>){
 const {customer}=await requireCustomer();const params=await searchParams;const tab=['orders','ledger','vouchers'].includes(first(params.tab))?first(params.tab):'products';
 const filters=historyFilters(params);const db=await createClient();const requestedAt=new Date().toISOString();
 const [settings,balance,purchasesEnabled]=await Promise.all([db.from('loyalty_settings').select('active').eq('id',true).single(),getCustomerCaracoinsBalance(customer.id),storePurchasesEnabled(customer.id)]);
 let content:React.ReactNode;
 if(tab==='vouchers'){
  const [templates,vouchers]=await Promise.all([db.from('store_voucher_templates').select('*').eq('active',true).order('created_at',{ascending:false}).limit(50),db.from('customer_store_vouchers').select('*',{count:'exact'}).eq('customer_id',customer.id).order('created_at',{ascending:false}).range((filters.page-1)*20,filters.page*20-1)]);
  const pages=Math.max(1,Math.ceil((vouchers.count??0)/20));
  if(!vouchers.error&&filters.page>pages)redirect(pageHref(path,params,pages));
  content=templates.error||vouchers.error?<Unavailable label="seus vouchers"/>:<><StoreVouchers purchasesEnabled={purchasesEnabled} templates={templates.data as VoucherTemplate[]} vouchers={vouchers.data as CustomerVoucher[]} balance={balance} now={Date.parse(requestedAt)}/><HistoryPagination path={path} params={{...params,tab:'vouchers'}} data={{page:filters.page,pages,total:vouchers.count??0,size:20}}/></>;
 }else if(tab==='orders'){
  const status=Object.hasOwn(customerOrderStages,first(params.status))?first(params.status):'all';
  const data=await getCustomerHistory(status,filters).catch(()=>null);
  if(data&&data.page!==filters.page)redirect(pageHref(path,params,data.page));
  content=data?<CustomerOrderHistory key={JSON.stringify(params)} data={data} status={status} filters={filters} params={{...params,tab:'orders'}}/>:<Unavailable label="seus pedidos"/>;
 }else if(tab==='ledger'){
  const data=await getCoinHistory(filters).catch(()=>null);
  if(data&&data.page!==filters.page)redirect(pageHref(path,params,data.page));
  content=data?<CoinHistoryView key={JSON.stringify(params)} data={data} filters={filters} params={{...params,tab:'ledger'}}/>:<Unavailable label="seu extrato"/>;
 }else{
  const catalogFilters=catalogFiltersFrom(params);const {mode,sort,category}=catalogFilters;
  const [catalog,open,wallet,banner]=await Promise.all([
   !settings.error&&settings.data?.active?getCustomerCatalog(filters.q,category,mode,sort,filters.page,catalogFilters).catch(()=>null):Promise.resolve(null),
   db.from('store_orders').select(STORE_ORDER_COLUMNS).eq('customer_id',customer.id).in('payment_status',['creating','pending']).maybeSingle(),
   db.from('customer_store_vouchers').select('*').eq('customer_id',customer.id).eq('status','available').gt('expires_at',new Date().toISOString()).order('expires_at').limit(100),
   db.from('store_banner').select('*').eq('id',true).maybeSingle(),
  ]);
  if(catalog&&catalog.page!==filters.page)redirect(pageHref(path,params,catalog.page));
  content=<>{!catalog&&<StoreSearch query={filters.q}/>}
   {open.error?<Unavailable label="seu pedido em andamento"/>:open.data&&<StoreOrderCard order={open.data as unknown as StoreOrder}/>}
   {settings.error||balance===null?<Unavailable label="a loja e seu saldo"/>:!settings.data?.active?<p className="rounded-xl border p-5 text-sm text-muted-foreground">A loja está em preparação. Você pode acompanhar suas compras em Meus pedidos.</p>:!catalog||open.error?<Unavailable label="os produtos da loja"/>:<><LoyaltyStorefront purchasesEnabled={purchasesEnabled} rewards={catalog.items} balance={balance} customerId={customer.id} hasOpenOrder={!!open.data} vouchers={(wallet.data ?? []) as CustomerVoucher[]} catalog={catalog} catalogFilters={catalogFilters} banner={banner.error?null:banner.data as StoreBanner|null??{active:false}}/><HistoryPagination path={path} params={params} data={catalog}/></>}</>;
 }
 return <div className="store-page grid min-w-0 gap-5"><header className="flex flex-wrap items-center justify-between gap-3"><div><Button asChild size="sm" variant="ghost" className="-ml-2"><Link href="/painel"><ArrowLeft/>Voltar ao painel</Link></Button><h1 className="mt-1 text-xl font-bold sm:text-2xl">Loja dos Caras</h1></div></header>
 <nav aria-label="Seções da loja" className="flex flex-wrap gap-1 border-b pb-2">{([['products','Produtos'],['vouchers','Vouchers'],['orders','Meus pedidos'],['ledger','Extrato']] as const).map(([key,label])=><Link key={key} href={`${path}?tab=${key}`} aria-current={tab===key?'page':undefined} className={`rounded-lg px-2 py-3 text-center text-xs font-semibold ${tab===key?'bg-amarelo/15 text-ouro-ink':'text-muted-foreground'}`}>{label}</Link>)}</nav>
 {content}</div>;
}
