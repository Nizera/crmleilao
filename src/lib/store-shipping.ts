import 'server-only';
import {isoDayAdd} from '@/lib/dates';
import { createAdminClient } from '@/lib/supabase/admin';

export type StoreShippingOrder={id:string;code:string;boxed_at:string|null;shipping_declared_value:number|null;items:{name:string;quantity:number;delivery_kind:string}[]};
export async function listStoreShippingOrders(customerId:string,day:string):Promise<StoreShippingOrder[]>{
 const db=createAdminClient();const {data,error}=await db.from('store_orders').select('id,code,boxed_at,shipping_declared_value,items:store_order_items(name,quantity,delivery_kind,unit_cash,unit_coins)')
 .eq('customer_id',customerId).eq('payment_status','paid').neq('fulfillment_status','fulfilled').is('shipment_id',null)
 .lt('created_at',`${isoDayAdd(day,1)}T00:00:00-03:00`).order('created_at').order('id').limit(501);
 if(error)throw new Error('Não foi possível conferir os pedidos físicos da loja. Confira a migration 0039.');
 if((data?.length??0)>500)throw new Error('Há muitos pedidos para um único pacote. Revise os pedidos com a equipe.');
 return (data ?? []).flatMap(order => {
  const physical = order.items.filter(item => item.delivery_kind === 'physical');
  if (!physical.length) return [];
  const cashCents = physical.reduce((sum, item) => sum + item.quantity * Math.round(Number(item.unit_cash) * 100), 0);
  const cashValue = physical.every(item => Number(item.unit_coins) === 0) && cashCents > 0 ? cashCents / 100 : null;
  return [{ ...order, shipping_declared_value: Number(order.shipping_declared_value) || cashValue }];
 });
}
export function storeDeclaredTotal(orders:StoreShippingOrder[]):number{
 if(orders.some(o=>!Number.isFinite(Number(o.shipping_declared_value))||Number(o.shipping_declared_value)<=0))throw new Error('Confira o valor declarado dos pedidos da loja antes de emitir.');
 return orders.reduce((sum,o)=>sum+Math.round(Number(o.shipping_declared_value)*100),0)/100;
}
