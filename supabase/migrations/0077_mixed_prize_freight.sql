-- Prêmios externos de R$0 liberados + prêmios do app podem compartilhar o frete da empresa.
begin;
create or replace function public.is_company_prize_package(p_shipment uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.shipments s where s.id=p_shipment
 and (exists(select 1 from public.shipment_lots where shipment_id=s.id)
  or exists(select 1 from public.logistics_pending p where p.customer_id=s.customer_id and p.cancelled_at is null
   and (p.shipment_id=s.id or (s.content_snapshot is null and p.shipment_id is null and p.shipping_date<=s.batch_date))))
 and not exists(select 1 from public.shipment_lots sl join public.lots l on l.id=sl.lot_id where sl.shipment_id=s.id
  and (l.customer_id<>s.customer_id or l.arremate_value<>0 or l.status not in('paid','shipped','delivered')
   or not exists(select 1 from public.external_prize_freight_releases r where r.lot_id=l.id and r.customer_id=l.customer_id)))
 and not exists(select 1 from public.logistics_pending p left join public.raffle_awards a on a.logistics_id=p.id left join public.raffle_orders o on o.id=a.order_id
  where p.customer_id=s.customer_id and (p.shipment_id=s.id or (s.content_snapshot is null and p.shipment_id is null and p.cancelled_at is null and p.shipping_date<=s.batch_date))
  and (p.source_kind<>'raffle' or p.cancelled_at is not null or o.status is distinct from 'paid'))
 and not exists(select 1 from public.store_orders o where o.customer_id=s.customer_id
  and (o.shipment_id=s.id or (s.content_snapshot is null and o.shipment_id is null and o.payment_status='paid' and o.fulfillment_status<>'fulfilled' and o.created_at<((s.batch_date+1)::timestamp at time zone 'America/Sao_Paulo')))
  and exists(select 1 from public.store_order_items i where i.order_id=o.id and i.delivery_kind='physical'))
 and (s.content_snapshot is not null or not exists(select 1 from public.lots l where l.customer_id=s.customer_id and l.arremate_value>0 and l.status='paid' and coalesce(l.shipping_date,s.batch_date)<=s.batch_date
  and not exists(select 1 from public.shipment_lots sl join public.shipments active on active.id=sl.shipment_id where sl.lot_id=l.id and active.status<>'cancelled')))
 );
$$;
revoke all on function public.is_company_prize_package(uuid) from public,anon,authenticated;
grant execute on function public.is_company_prize_package(uuid) to service_role;
create or replace function public.claim_shipment_freight(p_shipment uuid) returns void language plpgsql security definer set search_path='' as $$
declare s public.shipments%rowtype;
begin
 select * into s from public.shipments where id=p_shipment for update;
 if not found or s.status<>'pending' then raise exception 'Envio indisponível.';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s.customer_id::text,0));
 if public.is_company_prize_package(s.id) then update public.shipments set freight_payer='company' where id=s.id;
 else perform public.claim_shipment_freight_before_external(s.id);end if;
end; $$;

create or replace function public.assert_shipment_freight(p_shipment uuid) returns void language plpgsql security definer set search_path='' as $$
declare s public.shipments%rowtype;
begin
 select * into s from public.shipments where id=p_shipment;
 if s.freight_payer='company' and public.is_company_prize_package(s.id) then return;end if;
 if s.freight_payer='company' then
  -- Usa somente o conteúdo congelado no envio. Novas compras não modificam
  -- retroativamente o pacote, mas nenhum item pago pode entrar como prêmio.
  if s.content_snapshot is null or jsonb_array_length(s.content_snapshot->'lots')<>0 or jsonb_array_length(s.content_snapshot->'store')<>0
   or exists(select 1 from public.shipment_lots where shipment_id=s.id)
   or exists(select 1 from public.store_orders where shipment_id=s.id)
   or not exists(select 1 from public.logistics_pending where shipment_id=s.id and source_kind='raffle')
   or exists(select 1 from public.logistics_pending l left join public.raffle_awards a on a.logistics_id=l.id left join public.raffle_orders o on o.id=a.order_id
    where l.shipment_id=s.id and (l.source_kind<>'raffle' or l.cancelled_at is not null or o.status is distinct from 'paid')) then raise exception 'Confira o conteúdo e o pagamento dos prêmios antes de pagar a etiqueta por conta da empresa.'; end if;
  return;
 end if;
 perform public.assert_shipment_freight_before_prize(p_shipment);
end; $$;

-- Validação sem criar etiqueta na transportadora: evita cancelamentos compensatórios previsíveis.
create or replace function public.validate_shipment_draft(p_customer uuid,p_day date,p_expected jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare actual jsonb; canonical jsonb;
begin
 if p_customer is null or p_day is null then raise exception 'Informe cliente e data do envio.';end if;
 if jsonb_typeof(p_expected->'lots') is distinct from 'array' or jsonb_typeof(p_expected->'store') is distinct from 'array' or jsonb_typeof(p_expected->'logistics') is distinct from 'array' then raise exception 'Conteúdo do pacote inválido.';end if;
 if jsonb_array_length(p_expected->'lots')>500 or jsonb_array_length(p_expected->'store')>500 or jsonb_array_length(p_expected->'logistics')>500 then raise exception 'Limite de itens excedido.';end if;
 perform public.assert_customer_shipping_ready(p_customer);
 perform public.assert_store_shipping_ready(p_customer,p_day);
 select jsonb_build_object(
 'lots',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'value',l.arremate_value) order by l.id) from public.lots l where l.customer_id=p_customer and l.status='paid' and l.id in(select (x->>'id')::uuid from jsonb_array_elements(p_expected->'lots') x) and not exists(select 1 from public.shipment_lots sl join public.shipments s on s.id=sl.shipment_id where sl.lot_id=l.id and s.status<>'cancelled')),'[]'::jsonb),
 'store',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'value',o.shipping_declared_value) order by o.id) from public.store_orders o where o.customer_id=p_customer and o.payment_status='paid' and o.fulfillment_status<>'fulfilled' and o.shipment_id is null and o.created_at<((p_day+1)::timestamp at time zone 'America/Sao_Paulo') and exists(select 1 from public.store_order_items i where i.order_id=o.id and i.delivery_kind='physical')),'[]'::jsonb),
 'logistics',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'value',p.shipping_declared_value) order by p.id) from public.logistics_pending p where p.customer_id=p_customer and p.shipping_date<=p_day and p.shipment_id is null and p.cancelled_at is null),'[]'::jsonb)) into actual;
 select jsonb_build_object('lots',coalesce((select jsonb_agg(x order by x->>'id') from jsonb_array_elements(p_expected->'lots') x),'[]'::jsonb),'store',coalesce((select jsonb_agg(x order by x->>'id') from jsonb_array_elements(p_expected->'store') x),'[]'::jsonb),'logistics',coalesce((select jsonb_agg(x order by x->>'id') from jsonb_array_elements(p_expected->'logistics') x),'[]'::jsonb)) into canonical;
 if actual<>canonical then raise exception 'O conteúdo do pacote mudou. Atualize a tela antes de emitir.';end if;
 if exists(select 1 from public.logistics_pending p left join public.raffle_awards a on a.logistics_id=p.id left join public.raffle_orders o on o.id=a.order_id where p.customer_id=p_customer and p.shipping_date<=p_day and p.shipment_id is null and p.cancelled_at is null and p.source_kind='raffle' and o.status is distinct from 'paid') then raise exception 'Há prêmio com pagamento em análise. Confira antes de emitir.';end if;
end $$;
revoke all on function public.validate_shipment_draft(uuid,date,jsonb) from public,anon,authenticated;
grant execute on function public.validate_shipment_draft(uuid,date,jsonb) to service_role;

alter table public.shipments add column if not exists cancellation_origin text check(cancellation_origin in('admin','rollback','superfrete')),
 add column if not exists cancellation_reason text check(char_length(cancellation_reason)<=500);
commit;
