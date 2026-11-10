-- Reposição pode acompanhar prêmios liberados sem gerar nova cobrança de frete.
begin;
create or replace function public.is_company_prize_package(p_shipment uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.shipments s where s.id=p_shipment
 and (exists(select 1 from public.shipment_lots where shipment_id=s.id)
  or exists(select 1 from public.logistics_pending p where p.customer_id=s.customer_id and p.source_kind='raffle' and p.cancelled_at is null
   and (p.shipment_id=s.id or (s.content_snapshot is null and p.shipment_id is null and p.shipping_date<=s.batch_date))))
 and not exists(select 1 from public.shipment_lots sl join public.lots l on l.id=sl.lot_id where sl.shipment_id=s.id
  and (l.customer_id<>s.customer_id or l.arremate_value<>0 or l.status not in('paid','shipped','delivered')
   or not exists(select 1 from public.external_prize_freight_releases r where r.lot_id=l.id and r.customer_id=l.customer_id)))
 and not exists(select 1 from public.logistics_pending p left join public.raffle_awards a on a.logistics_id=p.id left join public.raffle_orders o on o.id=a.order_id
  where p.customer_id=s.customer_id and (p.shipment_id=s.id or (s.content_snapshot is null and p.shipment_id is null and p.cancelled_at is null and p.shipping_date<=s.batch_date))
  and (p.source_kind not in('raffle','replacement') or p.cancelled_at is not null or (p.source_kind='raffle' and o.status is distinct from 'paid')))
 and not exists(select 1 from public.store_orders o where o.customer_id=s.customer_id
  and (o.shipment_id=s.id or (s.content_snapshot is null and o.shipment_id is null and o.payment_status='paid' and o.fulfillment_status<>'fulfilled' and o.created_at<((s.batch_date+1)::timestamp at time zone 'America/Sao_Paulo')))
  and exists(select 1 from public.store_order_items i where i.order_id=o.id and i.delivery_kind='physical'))
 and (s.content_snapshot is not null or not exists(select 1 from public.lots l where l.customer_id=s.customer_id and l.arremate_value>0 and l.status='paid' and coalesce(l.shipping_date,s.batch_date)<=s.batch_date
  and not exists(select 1 from public.shipment_lots sl join public.shipments active on active.id=sl.shipment_id where sl.lot_id=l.id and active.status<>'cancelled')))
 );
$$;
revoke all on function public.is_company_prize_package(uuid) from public,anon,authenticated;
grant execute on function public.is_company_prize_package(uuid) to service_role;

commit;
notify pgrst, 'reload schema';
