-- Separação física e valor individual opcionais para prêmios e reposições.
-- Mantém pagamento, frete, snapshot, propriedade e proteção contra estornos.
begin;

create or replace function public.box_raffle_award(p_issue uuid,p_value numeric) returns void
language plpgsql security definer set search_path='' as $$
declare customer uuid; issue public.logistics_pending%rowtype;
begin
 if not public.has_staff_write() then raise exception 'Acesso negado.' using errcode='42501'; end if;
 if p_value is null or p_value<0 or p_value>100000 or p_value<>round(p_value,2) then raise exception 'Valor declarado inválido.'; end if;
 select customer_id into customer from public.logistics_pending where id=p_issue;
 if customer is null then raise exception 'Prêmio não encontrado.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(customer::text,0));
 select * into issue from public.logistics_pending where id=p_issue for update;
 if issue.source_kind<>'raffle' or issue.cancelled_at is not null or issue.shipment_id is not null then raise exception 'Prêmio indisponível para separação.'; end if;
 if not exists(select 1 from public.raffle_awards a join public.raffle_orders o on o.id=a.order_id where a.logistics_id=p_issue and o.status='paid') then raise exception 'Confira o pagamento do prêmio antes da separação.'; end if;
 if issue.moved_at is not null and issue.shipping_declared_value>0 then return; end if;
 update public.logistics_pending set shipping_declared_value=p_value,moved_at=coalesce(moved_at,now()),moved_by=auth.uid() where id=p_issue;
end; $$;

create or replace function public.require_raffle_box_value() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.source_kind='raffle' and new.cancelled_at is null and (new.moved_at is not null or new.shipment_id is not null)
  and not exists(select 1 from public.raffle_awards a join public.raffle_orders o on o.id=a.order_id where a.logistics_id=new.id and o.status='paid') then raise exception 'Confira o pagamento do prêmio antes de enviar.'; end if;
 return new;
end; $$;

create or replace function public.bind_store_orders_to_shipment(p_shipment uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare s public.shipments%rowtype; n integer;
begin
 select * into s from public.shipments where id=p_shipment for update;
 if not found or s.status<>'pending' then raise exception 'Envio indisponível.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s.customer_id::text,0));
 perform 1 from public.logistics_pending where customer_id=s.customer_id and shipping_date<=s.batch_date
   and cancelled_at is null and shipment_id is null order by id for update;
 n:=public.bind_store_orders_before_logistics(p_shipment);
 update public.logistics_pending set shipment_id=s.id where customer_id=s.customer_id and shipping_date<=s.batch_date
   and cancelled_at is null and shipment_id is null;
 return n;
end; $$;

create or replace function public.bind_shipment_contents(p_shipment uuid,p_expected jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare s public.shipments%rowtype; actual jsonb; canonical jsonb; declared numeric; n integer; override_value numeric;
begin
 select * into s from public.shipments where id=p_shipment for update;
 if not found or s.status<>'pending' then raise exception 'Envio indisponível.'; end if;
 if jsonb_typeof(p_expected->'store') is distinct from 'array' or jsonb_typeof(p_expected->'logistics') is distinct from 'array' or jsonb_typeof(p_expected->'lots') is distinct from 'array' then raise exception 'Conteúdo do pacote inválido.'; end if;
 if jsonb_array_length(p_expected->'store')>500 or jsonb_array_length(p_expected->'logistics')>500 or jsonb_array_length(p_expected->'lots')>500 then raise exception 'Limite de itens do pacote excedido.'; end if;
 select jsonb_build_object('store',coalesce((select jsonb_agg(x order by x->>'id') from jsonb_array_elements(p_expected->'store') x),'[]'::jsonb),
 'logistics',coalesce((select jsonb_agg(x order by x->>'id') from jsonb_array_elements(p_expected->'logistics') x),'[]'::jsonb),
 'lots',coalesce((select jsonb_agg(x order by x->>'id') from jsonb_array_elements(p_expected->'lots') x),'[]'::jsonb)) into canonical;
 if p_expected ? 'declared_value' then
  override_value:=(p_expected->>'declared_value')::numeric;
  if override_value is null or override_value<=0 or override_value>100000 or override_value<>round(override_value,2) then raise exception 'Valor declarado inválido.';end if;
  canonical:=canonical||jsonb_build_object('declared_value',override_value);
 end if;
 if s.content_snapshot is not null then
  if s.content_snapshot<>canonical then raise exception 'O conteúdo desta etiqueta já foi definido.'; end if;
  return 0;
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s.customer_id::text,0));
 -- Trava também pedidos ainda não pagos: eles não podem virar outro item
 -- elegível/na caixa entre a comparação e o vínculo.
 perform id from public.store_orders where customer_id=s.customer_id and created_at<((s.batch_date+1)::timestamp at time zone 'America/Sao_Paulo') order by id for update;
 perform id from public.logistics_pending where customer_id=s.customer_id and shipping_date<=s.batch_date order by id for update;
 perform l.id from public.lots l join public.shipment_lots sl on sl.lot_id=l.id where sl.shipment_id=s.id order by l.id for update of l;
 select jsonb_build_object(
 'store',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'value',o.shipping_declared_value) order by o.id) from public.store_orders o where o.customer_id=s.customer_id and o.payment_status='paid' and o.fulfillment_status<>'fulfilled' and o.shipment_id is null and o.created_at<((s.batch_date+1)::timestamp at time zone 'America/Sao_Paulo') and exists(select 1 from public.store_order_items i where i.order_id=o.id and i.delivery_kind='physical')),'[]'::jsonb),
 'logistics',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'value',p.shipping_declared_value) order by p.id) from public.logistics_pending p where p.customer_id=s.customer_id and p.shipping_date<=s.batch_date and p.shipment_id is null and p.cancelled_at is null),'[]'::jsonb),
 'lots',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'value',l.arremate_value) order by l.id) from public.shipment_lots sl join public.lots l on l.id=sl.lot_id where sl.shipment_id=s.id and l.customer_id=s.customer_id and l.status='paid'),'[]'::jsonb)) into actual;
 if override_value is not null then actual:=actual||jsonb_build_object('declared_value',override_value);end if;
 if actual<>canonical then raise exception 'O conteúdo do pacote mudou durante a emissão. Atualize a separação e emita novamente.'; end if;
 select coalesce(sum((x->>'value')::numeric),0) into declared from jsonb_array_elements((actual->'store')||(actual->'logistics')||(actual->'lots')) x;
 if override_value is not null then declared:=override_value;end if;
 if s.insurance_value>0 and round(s.insurance_value,2)<>round(declared,2) then raise exception 'O seguro não corresponde ao conteúdo declarado.'; end if;
 n:=public.bind_store_orders_to_shipment(s.id);
 perform public.assert_shipment_raffle_payments(s.id);
 -- Defesa adicional contra qualquer camada de vínculo que acrescente itens.
 select jsonb_build_object(
 'store',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'value',o.shipping_declared_value) order by o.id) from public.store_orders o where o.shipment_id=s.id),'[]'::jsonb),
 'logistics',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'value',p.shipping_declared_value) order by p.id) from public.logistics_pending p where p.shipment_id=s.id),'[]'::jsonb),
 'lots',actual->'lots') into actual;
 if override_value is not null then actual:=actual||jsonb_build_object('declared_value',override_value);end if;
 if actual<>canonical then raise exception 'O conteúdo vinculado diverge da declaração. Emita novamente.'; end if;
 update public.shipments set content_snapshot=canonical where id=s.id;
 return n;
end; $$;

create or replace function public.raffle_only_package(p_customer uuid,p_day date,p_shipment uuid default null) returns boolean
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
  and (l.source_kind<>'raffle' or o.status is distinct from 'paid'));
$$;

create or replace function public.assert_shipment_freight(p_shipment uuid) returns void language plpgsql security definer set search_path='' as $$
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
    where l.shipment_id=s.id and (l.source_kind<>'raffle' or l.cancelled_at is not null or o.status is distinct from 'paid')) then raise exception 'Confira o conteúdo e o pagamento dos prêmios antes de pagar a etiqueta por conta da empresa.'; end if;
  return;
 end if;
 perform public.assert_shipment_freight_before_prize(p_shipment);
end; $$;

commit;
