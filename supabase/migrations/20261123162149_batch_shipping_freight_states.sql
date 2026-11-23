-- Optimize read-only freight state lookup; preserve existing permissions and business rules.
-- Eligibility mirrors get_due_freight_periods_before_checkout, after paid/open-payment gates.
create or replace function public.shipping_freight_states(p_customers uuid[])
returns table(customer_id uuid,status text)
language sql stable security definer set search_path=''
as $function$
with
available_auction as materialized (
 select distinct c.customer_id from public.charges c
 where c.customer_id=any(p_customers) and c.status='approved' and c.freight_amount>0
 and not exists(select 1 from public.shipment_freight_usage u join public.shipments s on s.id=u.shipment_id where u.charge_id=c.id and s.status<>'cancelled')
),
available_store as materialized (
 select distinct o.customer_id from public.store_orders o
 where o.customer_id=any(p_customers) and o.payment_status='paid' and o.freight_amount>0
 and not exists(select 1 from public.shipment_store_freight_usage u join public.shipments s on s.id=u.shipment_id where u.order_id=o.id and s.status<>'cancelled')
),
awaiting as materialized (
 select c.customer_id from public.charges c where c.customer_id=any(p_customers) and c.freight_amount>0 and c.status in('pending','in_process')
 union
 select o.customer_id from public.store_orders o where o.customer_id=any(p_customers) and o.freight_amount>0 and o.payment_status in('creating','pending','partially_refunded','payment_review')
),
eligible as materialized (
 select distinct l.customer_id from public.lots l
 where l.customer_id=any(p_customers) and l.status in('pending_payment','paid') and (l.arremate_value>0 or l.voucher_amount>0)
 and not exists(select 1 from public.lot_freight_waivers w where w.lot_id=l.id and w.customer_id=l.customer_id)
 and not exists(select 1 from public.shipment_lots sl join public.shipments s on s.id=sl.shipment_id where sl.lot_id=l.id and s.status<>'cancelled')
),
allocated as materialized (
 select u.customer_id from public.shipment_freight_usage u join public.shipments s on s.id=u.shipment_id join public.charges c on c.id=u.charge_id
 where u.customer_id=any(p_customers) and s.status in('pending','released') and c.status='approved'
 union
 select u.customer_id from public.shipment_store_freight_usage u join public.shipments s on s.id=u.shipment_id join public.store_orders o on o.id=u.order_id
 where u.customer_id=any(p_customers) and s.status in('pending','released') and o.payment_status='paid'
)
select input.customer_id,case
 when aa.customer_id is not null or ast.customer_id is not null then 'paid'
 when aw.customer_id is not null then 'awaiting'
 when e.customer_id is not null then 'due'
 when a.customer_id is not null then 'paid'
 else 'none' end::text status
from unnest(p_customers) input(customer_id)
left join available_auction aa using(customer_id)
left join available_store ast using(customer_id)
left join awaiting aw using(customer_id)
left join eligible e using(customer_id)
left join allocated a using(customer_id);
$function$;
