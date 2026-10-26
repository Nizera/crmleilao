import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin,requireCustomer } from '@/lib/dal';
import type { HistoryFilters,CoinHistory,CustomerOrders,CustomerCatalog } from './loyalty-history';

export async function getCoinHistory(f:HistoryFilters,admin=false){
 let customerId:string|null=null;
 if(admin)await requireAdmin();else customerId=(await requireCustomer()).customer.id;
 const db=await createClient();const {data,error}=await db.rpc('get_caracoins_history',{p_query:f.q,p_kind:f.kind,p_from:f.from||null,p_to:f.to||null,p_page:f.page,p_size:f.size,p_customer:customerId});
 if(error)throw new Error('Não foi possível carregar o extrato.');return data as CoinHistory;
}
export async function getCustomerHistory(status:string,f:HistoryFilters){
 await requireCustomer();const db=await createClient();
 const {data,error}=await db.rpc('get_customer_order_history',{p_status:status,p_from:f.from||null,p_to:f.to||null,p_page:f.page});
 if(error)throw new Error('Não foi possível carregar os pedidos.');return data as CustomerOrders;
}
export async function getCustomerCatalog(q:string,category:string,mode:string,sort:string,page:number){
 await requireCustomer();const db=await createClient();
 const {data,error}=await db.rpc('get_customer_store_catalog',{p_query:q,p_category:category,p_mode:mode,p_sort:sort,p_page:page});
 if(error)throw new Error('Não foi possível carregar os produtos.');return data as CustomerCatalog;
}
export async function getLoyaltySettingsData(){
 await requireAdmin();const db=await createClient();
 const [settings,history]=await Promise.all([db.from('loyalty_settings').select('active,ranking_enabled,points_per_real,points_expire_days').eq('id',true).single(),db.from('loyalty_settings_history').select('id,active,note,effective_at').order('effective_at',{ascending:false}).limit(10)]);
 return {settings:settings.data,history:history.data??[],error:settings.error||history.error?'Não foi possível carregar as configurações.':null};
}
