-- Conteúdo declarado e conteúdo vinculado devem ser o mesmo conjunto.
-- Não altera valores de arremates, saldos, moedas ou liberação de compras.
begin;
alter table public.logistics_pending add column shipping_declared_value numeric(12,2) not null default 0 check(shipping_declared_value between 0 and 100000);
alter table public.shipments add column content_snapshot jsonb;

-- Uma etiqueta criada ainda não significa prêmio despachado. Estorno bloqueia
-- a separação mesmo com vínculo; cancelar a etiqueta não reativa o prêmio.
create or replace function public.release_logistics_on_cancel() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='cancelled' and old.status is distinct from new.status then
  update public.logistics_pending l set shipment_id=null,
   cancelled_at=case when l.source_kind='raffle' and not exists(
    select 1 from public.raffle_awards a join public.raffle_orders o on o.id=a.order_id
    where a.logistics_id=l.id and o.status='paid') then coalesce(l.cancelled_at,now()) else l.cancelled_at end
  where l.shipment_id=new.id;
 end if;
 return new;
end; $$;
revoke all on function public.release_logistics_on_cancel() from public,anon,authenticated;

create function public.assert_shipment_raffle_payments(p_shipment uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.logistics_pending l
  left join public.raffle_awards a on a.logistics_id=l.id
  left join public.raffle_orders o on o.id=a.order_id
  where l.shipment_id=p_shipment and l.source_kind='raffle'
   and (l.cancelled_at is not null or o.status is distinct from 'paid')) then
  raise exception 'Há prêmio com pagamento em análise neste pacote. Cancele a etiqueta e confira a rifa antes de enviar.';
 end if;
end; $$;
revoke all on function public.assert_shipment_raffle_payments(uuid) from public,anon,authenticated;
grant execute on function public.assert_shipment_raffle_payments(uuid) to service_role;

create function public.box_raffle_award(p_issue uuid,p_value numeric) returns void
language plpgsql security definer set search_path='' as $$
declare customer uuid; issue public.logistics_pending%rowtype;
begin
 if not public.has_staff_write() then raise exception 'Acesso negado.' using errcode='42501'; end if;
 if p_value is null or p_value<=0 or p_value>100000 or p_value<>round(p_value,2) then raise exception 'Informe o valor declarado do prêmio em reais.'; end if;
 select customer_id into customer from public.logistics_pending where id=p_issue;
 if customer is null then raise exception 'Prêmio não encontrado.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(customer::text,0));
 select * into issue from public.logistics_pending where id=p_issue for update;
 if issue.source_kind<>'raffle' or issue.cancelled_at is not null or issue.shipment_id is not null then raise exception 'Prêmio indisponível para separação.'; end if;
 if not exists(select 1 from public.raffle_awards a join public.raffle_orders o on o.id=a.order_id where a.logistics_id=p_issue and o.status='paid') then raise exception 'Confira o pagamento do prêmio antes da separação.'; end if;
 if issue.moved_at is not null and issue.shipping_declared_value>0 then return; end if;
 update public.logistics_pending set shipping_declared_value=p_value,moved_at=coalesce(moved_at,now()),moved_by=auth.uid() where id=p_issue;
end; $$;
revoke all on function public.box_raffle_award(uuid,numeric) from public,anon;
grant execute on function public.box_raffle_award(uuid,numeric) to authenticated;

create function public.require_raffle_box_value() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.source_kind='raffle' and new.moved_at is not null and new.shipping_declared_value<=0
  and (new.shipment_id is not null or new.moved_at is distinct from old.moved_at or new.shipping_declared_value is distinct from old.shipping_declared_value) then raise exception 'Confira o valor declarado do prêmio antes de colocar na caixa.'; end if;
 if new.source_kind='raffle' and new.cancelled_at is null and (new.moved_at is not null or new.shipment_id is not null)
  and not exists(select 1 from public.raffle_awards a join public.raffle_orders o on o.id=a.order_id where a.logistics_id=new.id and o.status='paid') then raise exception 'Confira o pagamento do prêmio antes de enviar.'; end if;
 return new;
end; $$;
create trigger raffle_box_value before update of moved_at,shipping_declared_value,shipment_id on public.logistics_pending for each row execute function public.require_raffle_box_value();
revoke all on function public.require_raffle_box_value() from public,anon,authenticated,service_role;

create function public.bind_shipment_contents(p_shipment uuid,p_expected jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare s public.shipments%rowtype; actual jsonb; canonical jsonb; declared numeric; n integer;
begin
 select * into s from public.shipments where id=p_shipment for update;
 if not found or s.status<>'pending' then raise exception 'Envio indisponível.'; end if;
 if jsonb_typeof(p_expected->'store') is distinct from 'array' or jsonb_typeof(p_expected->'logistics') is distinct from 'array' or jsonb_typeof(p_expected->'lots') is distinct from 'array' then raise exception 'Conteúdo do pacote inválido.'; end if;
 if jsonb_array_length(p_expected->'store')>500 or jsonb_array_length(p_expected->'logistics')>500 or jsonb_array_length(p_expected->'lots')>500 then raise exception 'Limite de itens do pacote excedido.'; end if;
 select jsonb_build_object('store',coalesce((select jsonb_agg(x order by x->>'id') from jsonb_array_elements(p_expected->'store') x),'[]'::jsonb),
 'logistics',coalesce((select jsonb_agg(x order by x->>'id') from jsonb_array_elements(p_expected->'logistics') x),'[]'::jsonb),
 'lots',coalesce((select jsonb_agg(x order by x->>'id') from jsonb_array_elements(p_expected->'lots') x),'[]'::jsonb)) into canonical;
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
 if actual<>canonical then raise exception 'O conteúdo do pacote mudou durante a emissão. Atualize a separação e emita novamente.'; end if;
 if exists(select 1 from public.logistics_pending where customer_id=s.customer_id and shipping_date<=s.batch_date and shipment_id is null and cancelled_at is null and source_kind='raffle' and (moved_at is null or shipping_declared_value<=0)) then raise exception 'Confira a separação e o valor declarado dos prêmios.'; end if;
 select coalesce(sum((x->>'value')::numeric),0) into declared from jsonb_array_elements((actual->'store')||(actual->'logistics')||(actual->'lots')) x;
 if s.insurance_value>0 and round(s.insurance_value,2)<>round(declared,2) then raise exception 'O seguro não corresponde ao conteúdo declarado.'; end if;
 n:=public.bind_store_orders_to_shipment(s.id);
 perform public.assert_shipment_raffle_payments(s.id);
 -- Defesa adicional contra qualquer camada de vínculo que acrescente itens.
 select jsonb_build_object(
 'store',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'value',o.shipping_declared_value) order by o.id) from public.store_orders o where o.shipment_id=s.id),'[]'::jsonb),
 'logistics',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'value',p.shipping_declared_value) order by p.id) from public.logistics_pending p where p.shipment_id=s.id),'[]'::jsonb),
 'lots',actual->'lots') into actual;
 if actual<>canonical then raise exception 'O conteúdo vinculado diverge da declaração. Emita novamente.'; end if;
 update public.shipments set content_snapshot=canonical where id=s.id;
 return n;
end; $$;
revoke all on function public.bind_shipment_contents(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.bind_shipment_contents(uuid,jsonb) to service_role;
commit;
