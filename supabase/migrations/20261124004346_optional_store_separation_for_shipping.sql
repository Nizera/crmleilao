-- Physical orders paid in cash use their recorded item prices until a declared value is saved.
create function public.store_shipment_declared_value(p_order uuid, p_saved numeric)
returns numeric language sql stable set search_path = '' as $$
  select coalesce(nullif(p_saved, 0), case
    when bool_and(i.unit_coins = 0) and sum(i.quantity * i.unit_cash) > 0
    then sum(i.quantity * i.unit_cash)
  end)
  from public.store_order_items i
  where i.order_id = p_order and i.delivery_kind = 'physical';
$$;
revoke all on function public.store_shipment_declared_value(uuid,numeric) from public,anon,authenticated;
grant execute on function public.store_shipment_declared_value(uuid,numeric) to service_role;

CREATE OR REPLACE FUNCTION public.assert_store_shipping_ready(p_customer uuid, p_day date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$begin
 if p_day is null then raise exception 'Informe a data de envio.';end if;
 if exists(select 1 from public.store_orders o where o.customer_id=p_customer and o.shipment_id is null and o.payment_status in('creating','pending','partially_refunded','payment_review')
 and o.created_at<((p_day+1)::timestamp at time zone 'America/Sao_Paulo') and exists(select 1 from public.store_order_items i where i.order_id=o.id and i.delivery_kind='physical')) then raise exception 'Há compra física da loja com pagamento pendente ou em análise. Confira antes de emitir.';end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.bind_store_orders_to_shipment_base(p_shipment uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 s public.shipments%rowtype;
 n integer;
begin
 select * into s
 from public.shipments
 where id=p_shipment
 for update;

 if not found or s.status<>'pending' then
  raise exception 'Envio indisponível.';
 end if;

 perform pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(s.customer_id::text,0)
 );

 perform public.assert_customer_shipping_ready_for_date(
  s.customer_id,s.batch_date
 );

 perform public.assert_store_shipping_ready(
  s.customer_id,s.batch_date
 );

 perform o.id
 from public.store_orders o
 where o.customer_id=s.customer_id
 and o.payment_status='paid'
 and o.fulfillment_status<>'fulfilled'
 and o.shipment_id is null
 and o.created_at<(
  (s.batch_date+1)::timestamp at time zone 'America/Sao_Paulo'
 )
 order by o.id
 for update;

 if exists(
  select 1 from public.store_orders o
  where o.customer_id=s.customer_id
  and o.payment_status='paid'
  and o.fulfillment_status<>'fulfilled'
  and o.shipment_id is null
  and o.created_at<(
   (s.batch_date+1)::timestamp at time zone 'America/Sao_Paulo'
  )
  and public.store_shipment_declared_value(o.id,o.shipping_declared_value) is null
  and exists(
   select 1 from public.store_order_items i
   where i.order_id=o.id and i.delivery_kind='physical'
  )
 ) then
  raise exception 'Confira o valor declarado dos pedidos da loja.';
 end if;

 update public.store_orders o
 set shipment_id=s.id, shipping_declared_value=public.store_shipment_declared_value(o.id,o.shipping_declared_value), updated_at=now()
 where o.customer_id=s.customer_id
 and o.payment_status='paid'
 and o.fulfillment_status<>'fulfilled'
 and o.shipment_id is null
 and o.created_at<(
  (s.batch_date+1)::timestamp at time zone 'America/Sao_Paulo'
 )
 and exists(
  select 1 from public.store_order_items i
  where i.order_id=o.id and i.delivery_kind='physical'
 );

 get diagnostics n=row_count;

 if n=0
 and not exists(
  select 1 from public.shipment_lots sl
  join public.lots l on l.id=sl.lot_id
  where sl.shipment_id=s.id
  and l.customer_id=s.customer_id
  and l.status='paid'
 )
 and not public.raffle_only_package(
  s.customer_id,s.batch_date,s.id
 ) then
  raise exception 'Nenhum lote, produto ou prêmio elegível disponível para envio.';
 end if;

 return n;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_store_shipment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.status='cancelled' then
    update public.store_orders set shipment_id=null,updated_at=now() where shipment_id=new.id;
  elsif new.status='delivered' then
    update public.store_orders set fulfillment_status='fulfilled',updated_at=now()
      where shipment_id=new.id and payment_status='paid' and fulfillment_status<>'fulfilled';
  end if;
  return new;
end; $function$
;

CREATE OR REPLACE FUNCTION public.bind_shipment_contents(p_shipment uuid, p_expected jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 'store',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'value',public.store_shipment_declared_value(o.id,o.shipping_declared_value)) order by o.id) from public.store_orders o where o.customer_id=s.customer_id and o.payment_status='paid' and o.fulfillment_status<>'fulfilled' and o.shipment_id is null and o.created_at<((s.batch_date+1)::timestamp at time zone 'America/Sao_Paulo') and exists(select 1 from public.store_order_items i where i.order_id=o.id and i.delivery_kind='physical')),'[]'::jsonb),
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
end; $function$
;

CREATE OR REPLACE FUNCTION public.validate_shipment_draft(p_customer uuid, p_day date, p_expected jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 actual jsonb;
 canonical jsonb;
begin
 if p_customer is null or p_day is null then
  raise exception 'Informe cliente e data do envio.';
 end if;

 if jsonb_typeof(p_expected->'lots') is distinct from 'array'
 or jsonb_typeof(p_expected->'store') is distinct from 'array'
 or jsonb_typeof(p_expected->'logistics') is distinct from 'array' then
  raise exception 'Conteúdo do pacote inválido.';
 end if;

 if jsonb_array_length(p_expected->'lots')>500
 or jsonb_array_length(p_expected->'store')>500
 or jsonb_array_length(p_expected->'logistics')>500 then
  raise exception 'Limite de itens excedido.';
 end if;

 perform public.assert_customer_shipping_ready_for_date(
  p_customer,p_day
 );

 perform public.assert_store_shipping_ready(p_customer,p_day);

 select jsonb_build_object(
  'lots',
  coalesce((
   select jsonb_agg(
    jsonb_build_object('id',l.id,'value',l.arremate_value)
    order by l.id
   )
   from public.lots l
   where l.customer_id=p_customer
   and l.status='paid'
   and l.id in(
    select (x->>'id')::uuid
    from jsonb_array_elements(p_expected->'lots') x
   )
   and not exists(
    select 1 from public.shipment_lots sl
    join public.shipments s on s.id=sl.shipment_id
    where sl.lot_id=l.id and s.status<>'cancelled'
   )
  ),'[]'::jsonb),

  'store',
  coalesce((
   select jsonb_agg(
    jsonb_build_object('id',o.id,'value',public.store_shipment_declared_value(o.id,o.shipping_declared_value))
    order by o.id
   )
   from public.store_orders o
   where o.customer_id=p_customer
   and o.payment_status='paid'
   and o.fulfillment_status<>'fulfilled'
   and o.shipment_id is null
   and o.created_at<(
    (p_day+1)::timestamp at time zone 'America/Sao_Paulo'
   )
   and exists(
    select 1 from public.store_order_items i
    where i.order_id=o.id and i.delivery_kind='physical'
   )
  ),'[]'::jsonb),

  'logistics',
  coalesce((
   select jsonb_agg(
    jsonb_build_object('id',p.id,'value',p.shipping_declared_value)
    order by p.id
   )
   from public.logistics_pending p
   where p.customer_id=p_customer
   and p.shipping_date<=p_day
   and p.shipment_id is null
   and p.cancelled_at is null
  ),'[]'::jsonb)
 ) into actual;

 select jsonb_build_object(
  'lots',
  coalesce((
   select jsonb_agg(x order by x->>'id')
   from jsonb_array_elements(p_expected->'lots') x
  ),'[]'::jsonb),
  'store',
  coalesce((
   select jsonb_agg(x order by x->>'id')
   from jsonb_array_elements(p_expected->'store') x
  ),'[]'::jsonb),
  'logistics',
  coalesce((
   select jsonb_agg(x order by x->>'id')
   from jsonb_array_elements(p_expected->'logistics') x
  ),'[]'::jsonb)
 ) into canonical;

 if actual<>canonical then
  raise exception 'O conteúdo do pacote mudou. Atualize a tela antes de emitir.';
 end if;

 if exists(
  select 1
  from public.logistics_pending p
  left join public.raffle_awards a on a.logistics_id=p.id
  left join public.raffle_orders o on o.id=a.order_id
  where p.customer_id=p_customer
  and p.shipping_date<=p_day
  and p.shipment_id is null
  and p.cancelled_at is null
  and p.source_kind='raffle'
  and o.status is distinct from 'paid'
 ) then
  raise exception 'Há prêmio com pagamento em análise. Confira antes de emitir.';
 end if;
end;
$function$
;
