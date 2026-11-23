-- Read-only regression: compare optimized lookup with the original helper-based business rules.
with inputs as materialized (
 select row_number()over(order by id)::integer case_id,array[id] input from public.customers
 union all select -1,array_agg(id order by id) from public.customers
 union all select -2,array[]::uuid[]
 union all select -3,null::uuid[]
 union all select -4,array[id,id,null::uuid] from(select id from public.customers order by id limit 1)c
 union all select -5,array['00000000-0000-0000-0000-000000000000'::uuid,null::uuid]
),
expected as materialized (
 select i.case_id,customer customer_id,case
when exists(select 1 from public.available_shipment_freight(customer)) or exists(select 1 from public.available_store_freight(customer)) then 'paid'
when exists(select 1 from public.charges where customer_id=customer and freight_amount>0 and status in('pending','in_process')) or exists(select 1 from public.store_orders where customer_id=customer and freight_amount>0 and payment_status in('creating','pending','partially_refunded','payment_review')) then 'awaiting'
when exists(select 1 from public.get_due_freight_periods(customer)) then 'due'
when exists(select 1 from public.shipment_freight_usage u join public.shipments s on s.id=u.shipment_id join public.charges c on c.id=u.charge_id where u.customer_id=customer and s.status in('pending','released') and c.status='approved')
or exists(select 1 from public.shipment_store_freight_usage u join public.shipments s on s.id=u.shipment_id join public.store_orders o on o.id=u.order_id where u.customer_id=customer and s.status in('pending','released') and o.payment_status='paid') then 'paid'
else 'none' end status from inputs i cross join lateral unnest(i.input) customer
),
actual as materialized (
 select i.case_id,s.* from inputs i cross join lateral public.shipping_freight_states(i.input) s
),
differences as (
 (select * from expected except all select * from actual)
 union all
 (select * from actual except all select * from expected)
)
select (select count(*) from inputs) test_cases,(select count(*) from actual) compared_rows,(select count(*) from differences) differences;