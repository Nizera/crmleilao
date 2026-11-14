-- Entrega própria usa os mesmos vínculos e o mesmo crédito de frete do pacote.
-- Não cria etiqueta nem pedido na SuperFrete.
begin;
alter table public.shipments add column if not exists delivery_method text not null default 'superfrete'
 check(delivery_method in ('superfrete','motoboy')),
 add column if not exists local_request_id uuid unique,
 add column if not exists delivery_note text check(char_length(delivery_note)<=500);
alter table public.shipments alter column sf_order_id drop not null;
alter table public.shipments drop constraint if exists shipment_delivery_provider;
alter table public.shipments add constraint shipment_delivery_provider check(
 (delivery_method='superfrete' and sf_order_id is not null and local_request_id is null)
 or (delivery_method='motoboy' and sf_order_id is null and local_request_id is not null
 and tracking_code is null and tracking_url is null and label_print_url is null));

create or replace function public.create_local_delivery(p_customer uuid,p_day date,p_expected jsonb,p_request uuid,p_note text default '')
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.shipments%rowtype; c public.customers%rowtype; shipment uuid; requested integer; linked integer;
begin
 if public.has_staff_write() is not true then raise exception 'Acesso negado.' using errcode='42501';end if;
 if p_customer is null or p_day is null or p_request is null or p_note is null or char_length(p_note)>500 then raise exception 'Confira cliente, data e observação.';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_customer::text,0));
 select * into s from public.shipments where local_request_id=p_request;
 if found then
  if s.customer_id<>p_customer or s.created_by is distinct from auth.uid() then raise exception 'Solicitação indisponível.';end if;
  return s.id;
 end if;
 select * into c from public.customers where id=p_customer;
 if not found or nullif(trim(c.name),'') is null or nullif(trim(c.phone_e164),'') is null
 or nullif(trim(c.address_street),'') is null or nullif(trim(c.address_number),'') is null
 or nullif(trim(c.address_city),'') is null then raise exception 'Preencha nome, telefone, rua, número e cidade do cliente antes de registrar a entrega.';end if;
 if p_expected is null or jsonb_typeof(p_expected)<>'object' or p_expected ? 'declared_value' then raise exception 'Conteúdo da entrega inválido.';end if;
 -- Mantém as conferências de data, propriedade, pagamento, loja e prêmios já usadas na emissão.
 perform public.validate_shipment_draft(p_customer,p_day,p_expected);
 requested:=jsonb_array_length(p_expected->'lots');
 if requested+jsonb_array_length(p_expected->'store')+jsonb_array_length(p_expected->'logistics')=0 then raise exception 'Nenhum item disponível para entrega.';end if;
 if exists(select 1 from public.lots l where l.id in(select (x->>'id')::uuid from jsonb_array_elements(p_expected->'lots') x)
 and (l.customer_id<>p_customer or l.status<>'paid' or l.shipping_date>p_day)) then raise exception 'Revise os lotes da entrega.';end if;
 insert into public.shipments(customer_id,batch_date,status,delivery_method,local_request_id,delivery_note,service_name,carrier,volume,address,sf_order_id,created_by)
 values(p_customer,p_day,'pending','motoboy',p_request,nullif(trim(p_note),''),'Entrega por motoboy','Motoboy','{}'::jsonb,
 jsonb_build_object('name',c.name,'phone',c.phone_e164,'address',c.address_street,'number',c.address_number,'complement',c.address_complement,
 'district',c.address_district,'city',c.address_city,'state_abbr',c.address_state,'postal_code',c.address_cep),null,auth.uid()) returning id into shipment;
 insert into public.shipment_lots(shipment_id,lot_id)
 select shipment,l.id from public.lots l where l.customer_id=p_customer and l.status='paid' and coalesce(l.shipping_date,p_day)<=p_day
 and l.id in(select (x->>'id')::uuid from jsonb_array_elements(p_expected->'lots') x)
 and not exists(select 1 from public.shipment_lots sl join public.shipments active on active.id=sl.shipment_id where sl.lot_id=l.id and active.status<>'cancelled');
 get diagnostics linked=row_count;
 if linked<>requested then raise exception 'Os lotes mudaram. Atualize a tela antes de confirmar.';end if;
 -- Congela conteúdo e reserva o crédito aprovado. Toda a saída é uma única transação.
 perform public.bind_shipment_contents(shipment,p_expected);
 perform public.assert_shipment_freight(shipment);
 update public.lots l set status='shipped',shipped_at=now() where l.status='paid'
 and exists(select 1 from public.shipment_lots sl where sl.shipment_id=shipment and sl.lot_id=l.id);
 update public.shipments set status='posted',posted_at=now(),events=events||jsonb_build_array(jsonb_build_object('event','motoboy.departed','received_at',now(),'actor',auth.uid())) where id=shipment;
 return shipment;
end; $$;
revoke all on function public.create_local_delivery(uuid,date,jsonb,uuid,text) from public,anon;
grant execute on function public.create_local_delivery(uuid,date,jsonb,uuid,text) to authenticated;

create or replace function public.handle_local_delivery(p_shipment uuid,p_action text) returns void
language plpgsql security definer set search_path='' as $$
declare s public.shipments%rowtype;
begin
 if public.has_staff_write() is not true then raise exception 'Acesso negado.' using errcode='42501';end if;
 select * into s from public.shipments where id=p_shipment for update;
 if not found or s.delivery_method<>'motoboy' then raise exception 'Entrega própria não encontrada.';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s.customer_id::text,0));
 if p_action='delivered' and s.status='delivered' then return;end if;
 if p_action='cancel' and s.status='cancelled' then return;end if;
 if s.status<>'posted' or p_action is null or p_action not in('delivered','cancel') then raise exception 'Esta entrega não permite essa alteração.';end if;
 if p_action='delivered' then
  update public.lots l set status='delivered' where l.status='shipped' and exists(select 1 from public.shipment_lots sl where sl.shipment_id=s.id and sl.lot_id=l.id);
  update public.store_orders set fulfillment_status='fulfilled',updated_at=now() where shipment_id=s.id and payment_status='paid';
  update public.shipments set status='delivered',delivered_at=now() where id=s.id;
 else
  update public.lots l set status='paid',shipped_at=null where l.status='shipped' and exists(select 1 from public.shipment_lots sl where sl.shipment_id=s.id and sl.lot_id=l.id);
  update public.store_orders set shipment_id=null,updated_at=now() where shipment_id=s.id;
  update public.logistics_pending set shipment_id=null where shipment_id=s.id;
  update public.shipments set status='cancelled',cancelled_at=now(),cancellation_origin='admin',cancellation_reason='Saída por motoboy cancelada pela equipe. Itens e frete disponíveis novamente.' where id=s.id;
 end if;
 update public.shipments set events=events||jsonb_build_array(jsonb_build_object('event','motoboy.'||p_action,'received_at',now(),'actor',auth.uid())) where id=s.id;
end; $$;
revoke all on function public.handle_local_delivery(uuid,text) from public,anon;
grant execute on function public.handle_local_delivery(uuid,text) to authenticated;

create or replace function public.get_shipment_cost_summary(
  p_day date default null, p_query text default '', p_status text default 'all', p_cost text default 'all'
) returns jsonb language sql stable security invoker set search_path='' as $$
  with filtered as (
    select s.* from public.shipments s left join public.customers c on c.id=s.customer_id
    where public.is_admin() and s.delivery_method='superfrete'
      and (p_day is null or s.batch_date=p_day)
      and (p_status='all' or s.status::text=p_status)
      and (p_cost='all' or (s.price_change_count>0 and (
        p_cost='changed' or (p_cost='increase' and s.price_difference>0) or (p_cost='decrease' and s.price_difference<0))))
      and (length(trim(p_query))<2 or
        strpos(lower(s.code),lower(trim(p_query)))>0 or
        strpos(lower(s.sf_order_id),lower(trim(p_query)))>0 or
        strpos(lower(coalesce(s.tracking_code,'')),lower(trim(p_query)))>0 or
        strpos(lower(coalesce(c.name,'')),lower(trim(p_query)))>0 or
        (length(regexp_replace(p_query,'[^0-9]','','g'))>=4 and
          strpos(c.phone_e164,regexp_replace(p_query,'[^0-9]','','g'))>0))
  ) select jsonb_build_object(
    'labels', count(*) filter(where status::text<>'cancelled'),
    'cancelled', count(*) filter(where status::text='cancelled'),
    'emissionTotal', coalesce(sum(coalesce(original_price,price)) filter(where status::text<>'cancelled'),0),
    'currentTotal', coalesce(sum(coalesce(price,original_price)) filter(where status::text<>'cancelled'),0),
    'adjustmentTotal', coalesce(sum(coalesce(price,original_price)-coalesce(original_price,price)) filter(where status::text<>'cancelled'),0),
    'changedLabels', count(*) filter(where status::text<>'cancelled' and price is not null and original_price is not null and price<>original_price),
    'unknownPrices', count(*) filter(where status::text<>'cancelled' and coalesce(original_price,price) is null),
    'legacyPrices', count(*) filter(where status::text<>'cancelled' and price_baseline_legacy)
  ) from filtered;
$$;
revoke all on function public.get_shipment_cost_summary(date,text,text,text) from public,anon;
grant execute on function public.get_shipment_cost_summary(date,text,text,text) to authenticated,service_role;


commit;
notify pgrst, 'reload schema';
