-- Zero-value lots never incur customer freight. A later positive lot is evaluated afresh.
-- Keep shipping/payment validation, store freight, existing credits and frozen packages intact.
begin;
-- Preserve the individual waivers already present in production; also support fresh installations.
create table if not exists public.lot_freight_waivers (
 lot_id uuid primary key references public.lots(id),
 customer_id uuid not null references public.customers(id),
 reason text not null check(length(trim(reason))>=10),
 created_at timestamptz not null default now()
);
create index if not exists lot_freight_waivers_customer on public.lot_freight_waivers(customer_id);
alter table public.lot_freight_waivers enable row level security;
revoke all on public.lot_freight_waivers from public,anon,authenticated;
grant select,insert,update,delete on public.lot_freight_waivers to service_role;

CREATE OR REPLACE FUNCTION public.get_due_freight_periods_before_checkout(p_customer uuid)
 RETURNS TABLE(freight_period date, first_lot_id uuid, freight_amount numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select l.auction_date-((extract(dow from l.auction_date)::integer-2+7)%7),l.id,20::numeric
 from public.lots l where l.customer_id=p_customer and l.status in('pending_payment','paid') and l.arremate_value>0
 and not exists(select 1 from public.lot_freight_waivers w where w.lot_id=l.id and w.customer_id=l.customer_id)
 and not exists(select 1 from public.shipment_lots sl join public.shipments s on s.id=sl.shipment_id where sl.lot_id=l.id and s.status<>'cancelled')
 and not exists(select 1 from public.available_shipment_freight(p_customer))
 and not exists(select 1 from public.charges c where c.customer_id=p_customer and c.freight_amount>0 and c.status in('pending','in_process'))
 order by l.created_at,l.id limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.require_lot_period_freight()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if new.charge_id is null or new.charge_id is not distinct from old.charge_id then return new;end if;
 if new.arremate_value=0 then return new;end if;
 if exists(select 1 from public.lot_freight_waivers w where w.lot_id=new.id and w.customer_id=new.customer_id) then return new;end if;
 if not exists(select 1 from public.available_shipment_freight(new.customer_id))
 and not exists(select 1 from public.available_store_freight(new.customer_id))
 and not exists(select 1 from public.charge_freight_items where customer_id=new.customer_id and charge_id=new.charge_id and status in('pending','in_process','approved'))
 and not exists(select 1 from public.store_orders where customer_id=new.customer_id and freight_amount>0 and payment_status in('creating','pending','partially_refunded','payment_review'))
 then raise exception 'O frete de R$20 do envio acumulado deve acompanhar o pagamento dos lotes.';end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION public.is_company_prize_package(p_shipment uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(
  select 1 from public.shipments s
  where s.id=p_shipment
  and (
   exists(select 1 from public.shipment_lots where shipment_id=s.id)
   or exists(
    select 1 from public.logistics_pending p
    where p.customer_id=s.customer_id
    and p.source_kind='raffle'
    and p.cancelled_at is null
    and (
     p.shipment_id=s.id
     or (
      s.content_snapshot is null
      and p.shipment_id is null
      and p.shipping_date<=s.batch_date
     )
    )
   )
  )
  and not exists(
   select 1 from public.shipment_lots sl
   join public.lots l on l.id=sl.lot_id
   where sl.shipment_id=s.id
   and (
    l.customer_id<>s.customer_id
    or l.arremate_value<>0
    or l.status not in('paid','shipped','delivered')
   )
  )
  and not exists(
   select 1 from public.logistics_pending p
   left join public.raffle_awards a on a.logistics_id=p.id
   left join public.raffle_orders o on o.id=a.order_id
   where p.customer_id=s.customer_id
   and (
    p.shipment_id=s.id
    or (
     s.content_snapshot is null
     and p.shipment_id is null
     and p.cancelled_at is null
     and p.shipping_date<=s.batch_date
    )
   )
   and (
    p.source_kind not in('raffle','replacement')
    or p.cancelled_at is not null
    or (
     p.source_kind='raffle'
     and o.status is distinct from 'paid'
    )
   )
  )
  and not exists(
   select 1 from public.store_orders o
   where o.customer_id=s.customer_id
   and (
    o.shipment_id=s.id
    or (
     s.content_snapshot is null
     and o.shipment_id is null
     and o.payment_status='paid'
     and o.fulfillment_status<>'fulfilled'
     and o.created_at<(
      (s.batch_date+1)::timestamp at time zone 'America/Sao_Paulo'
     )
    )
   )
   and exists(
    select 1 from public.store_order_items i
    where i.order_id=o.id and i.delivery_kind='physical'
   )
  )
  and (
   s.content_snapshot is not null
   or not exists(
    select 1 from public.lots l
    where l.customer_id=s.customer_id
    and l.arremate_value>0
    and l.status='paid'
    and coalesce(l.shipping_date,s.batch_date)<=s.batch_date
    and not exists(
     select 1 from public.shipment_lots sl
     join public.shipments active on active.id=sl.shipment_id
     where sl.lot_id=l.id and active.status<>'cancelled'
    )
   )
  )
 );
$function$;

-- CREATE OR REPLACE preserves grants; explicitly keep these helpers internal.
revoke all on function public.get_due_freight_periods_before_checkout(uuid), public.require_lot_period_freight(), public.is_company_prize_package(uuid) from public,anon,authenticated;
grant execute on function public.is_company_prize_package(uuid) to service_role;
commit;
notify pgrst, 'reload schema';
