-- Integra a declaração manual ao snapshot da versão completa, sem alterar valores financeiros.
begin;
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
 if exists(select 1 from public.logistics_pending where customer_id=s.customer_id and shipping_date<=s.batch_date and shipment_id is null and cancelled_at is null and source_kind='raffle' and (moved_at is null or shipping_declared_value<=0)) then raise exception 'Confira a separação e o valor declarado dos prêmios.'; end if;
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
commit;
