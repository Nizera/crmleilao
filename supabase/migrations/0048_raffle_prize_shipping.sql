begin;
alter table public.shipments add column freight_payer text not null default 'customer' check(freight_payer in('customer','company'));

-- Benefício exclusivo de pacote composto apenas por prêmios pagos de rifa.
-- Não consome créditos de frete do cliente e não isenta compras ou lotes.
create function public.raffle_only_package(p_customer uuid,p_day date,p_shipment uuid default null) returns boolean
language sql stable security definer set search_path='' as $$
 select p_customer is not null and p_day is not null
 and not exists(select 1 from public.shipment_lots where shipment_id=p_shipment)
 and not exists(select 1 from public.lots l where l.customer_id=p_customer and l.status='paid' and coalesce(l.shipping_date,p_day)<=p_day
  and not exists(select 1 from public.shipment_lots sl join public.shipments s on s.id=sl.shipment_id where sl.lot_id=l.id and s.status<>'cancelled'))
 and not exists(select 1 from public.store_orders o where o.customer_id=p_customer and o.payment_status='paid' and o.fulfillment_status<>'fulfilled'
  and (o.shipment_id is null or o.shipment_id=p_shipment) and o.created_at<((p_day+1)::timestamp at time zone 'America/Sao_Paulo')
  and exists(select 1 from public.store_order_items i where i.order_id=o.id and i.delivery_kind='physical'))
 and exists(select 1 from public.logistics_pending l where l.customer_id=p_customer and l.shipping_date<=p_day and l.cancelled_at is null and (l.shipment_id is null or l.shipment_id=p_shipment))
 and not exists(select 1 from public.logistics_pending l left join public.raffle_awards a on a.logistics_id=l.id left join public.raffle_orders o on o.id=a.order_id
  where l.customer_id=p_customer and l.shipping_date<=p_day and l.cancelled_at is null and (l.shipment_id is null or l.shipment_id=p_shipment)
  and (l.source_kind<>'raffle' or l.moved_at is null or l.shipping_declared_value<=0 or o.status is distinct from 'paid'));
$$;
revoke all on function public.raffle_only_package(uuid,date,uuid) from public,anon,authenticated;
grant execute on function public.raffle_only_package(uuid,date,uuid) to service_role;

alter function public.claim_shipment_freight(uuid) rename to claim_shipment_freight_before_prize;
revoke all on function public.claim_shipment_freight_before_prize(uuid) from public,anon,authenticated,service_role;
create function public.claim_shipment_freight(p_shipment uuid) returns void language plpgsql security definer set search_path='' as $$
declare s public.shipments%rowtype;
begin
 select * into s from public.shipments where id=p_shipment for update;
 if not found or s.status<>'pending' then raise exception 'Envio indisponível.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s.customer_id::text,0));
 if public.raffle_only_package(s.customer_id,s.batch_date,s.id) then
  update public.shipments set freight_payer='company' where id=s.id;
 else
  perform public.claim_shipment_freight_before_prize(s.id);
  update public.shipments set freight_payer='customer' where id=s.id;
 end if;
end; $$;
revoke all on function public.claim_shipment_freight(uuid) from public,anon,authenticated;
grant execute on function public.claim_shipment_freight(uuid) to service_role;

alter function public.assert_shipment_freight(uuid) rename to assert_shipment_freight_before_prize;
revoke all on function public.assert_shipment_freight_before_prize(uuid) from public,anon,authenticated,service_role;
create function public.assert_shipment_freight(p_shipment uuid) returns void language plpgsql security definer set search_path='' as $$
declare s public.shipments%rowtype;
begin
 select * into s from public.shipments where id=p_shipment;
 if s.freight_payer='company' then
  -- Usa somente o conteúdo congelado no envio. Novas compras não modificam
  -- retroativamente o pacote, mas nenhum item pago pode entrar como prêmio.
  if s.content_snapshot is null or jsonb_array_length(s.content_snapshot->'lots')<>0 or jsonb_array_length(s.content_snapshot->'store')<>0
   or exists(select 1 from public.shipment_lots where shipment_id=s.id)
   or exists(select 1 from public.store_orders where shipment_id=s.id)
   or not exists(select 1 from public.logistics_pending where shipment_id=s.id and source_kind='raffle')
   or exists(select 1 from public.logistics_pending l left join public.raffle_awards a on a.logistics_id=l.id left join public.raffle_orders o on o.id=a.order_id
    where l.shipment_id=s.id and (l.source_kind<>'raffle' or l.cancelled_at is not null or l.moved_at is null or l.shipping_declared_value<=0 or o.status is distinct from 'paid')) then raise exception 'Confira o conteúdo e o pagamento dos prêmios antes de pagar a etiqueta por conta da empresa.'; end if;
  return;
 end if;
 perform public.assert_shipment_freight_before_prize(p_shipment);
end; $$;
revoke all on function public.assert_shipment_freight(uuid) from public,anon,authenticated;
grant execute on function public.assert_shipment_freight(uuid) to service_role;
create or replace function public.bind_store_orders_to_shipment_base(p_shipment uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare s public.shipments%rowtype;n integer;
begin
 select * into s from public.shipments where id=p_shipment for update;
 if not found or s.status<>'pending' then raise exception 'Envio indisponível.';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s.customer_id::text,0));
 perform public.assert_customer_shipping_ready(s.customer_id);
 perform public.assert_store_shipping_ready(s.customer_id,s.batch_date);
 perform o.id from public.store_orders o where o.customer_id=s.customer_id and o.payment_status='paid' and o.fulfillment_status<>'fulfilled' and o.shipment_id is null
 and o.created_at<((s.batch_date+1)::timestamp at time zone 'America/Sao_Paulo') order by o.id for update;
 if exists(select 1 from public.store_orders o where o.customer_id=s.customer_id and o.payment_status='paid' and o.fulfillment_status<>'fulfilled' and o.shipment_id is null and o.boxed_at is not null
 and o.created_at<((s.batch_date+1)::timestamp at time zone 'America/Sao_Paulo') and o.shipping_declared_value is null
 and exists(select 1 from public.store_order_items i where i.order_id=o.id and i.delivery_kind='physical')) then raise exception 'Confira o valor declarado dos pedidos da loja.';end if;
 update public.store_orders o set shipment_id=s.id,updated_at=now() where o.customer_id=s.customer_id and o.payment_status='paid'
 and o.fulfillment_status<>'fulfilled' and o.boxed_at is not null and o.shipment_id is null and o.created_at<((s.batch_date+1)::timestamp at time zone 'America/Sao_Paulo')
 and exists(select 1 from public.store_order_items i where i.order_id=o.id and i.delivery_kind='physical');
 get diagnostics n=row_count;
 if n=0 and not exists(select 1 from public.shipment_lots sl join public.lots l on l.id=sl.lot_id where sl.shipment_id=s.id and l.customer_id=s.customer_id and l.status='paid') and not public.raffle_only_package(s.customer_id,s.batch_date,s.id) then raise exception 'Nenhum lote, produto ou prêmio elegível disponível para envio.';end if;
 return n;
end $$;
commit;
