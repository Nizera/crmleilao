-- Requer 0038 e migrations anteriores. Mantém compras fechadas.
begin;
alter table public.store_orders add column shipping_declared_value numeric(12,2) check(shipping_declared_value>0);

-- Cliente que compra item físico precisa ter um endereço utilizável antes de pagar.
alter function public.checkout_store_cart_v2(uuid,jsonb,uuid) rename to checkout_store_cart_before_shipping;
revoke all on function public.checkout_store_cart_before_shipping(uuid,jsonb,uuid) from public,anon,authenticated,service_role;
create function public.checkout_store_cart_v2(p_request_key uuid,p_items jsonb,p_voucher uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare customer uuid:=public.current_customer_id();existing uuid;
begin
 if customer is null or p_request_key is null then raise exception 'Cliente não autenticado.';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(customer::text,0));
 select id into existing from public.store_orders where customer_id=customer and request_key=p_request_key;
 if found then return existing;end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'Carrinho inválido.';end if;
 if exists(select 1 from jsonb_to_recordset(p_items)x(reward_id uuid) join public.loyalty_rewards r on r.id=x.reward_id where r.delivery_kind='physical')
 and not exists(select 1 from public.customers c where c.id=customer and length(trim(coalesce(c.name,'')))>0 and length(regexp_replace(coalesce(c.cpf_cnpj,''),'[^0-9]','','g')) in(11,14)
 and length(regexp_replace(coalesce(c.address_cep,''),'[^0-9]','','g'))=8 and length(trim(coalesce(c.address_street,'')))>0 and length(trim(coalesce(c.address_number,'')))>0
 and length(trim(coalesce(c.address_district,'')))>0 and length(trim(coalesce(c.address_city,'')))>0 and c.address_state ~ '^[A-Z]{2}$') then raise exception 'Preencha seu endereço completo e documento antes de comprar produtos físicos.';end if;
 return public.checkout_store_cart_before_shipping(p_request_key,p_items,p_voucher);
end $$;
revoke all on function public.checkout_store_cart_v2(uuid,jsonb,uuid) from public,anon;
grant execute on function public.checkout_store_cart_v2(uuid,jsonb,uuid) to authenticated;

-- Frete continua separado de produtos e descontos, com o crédito único do pacote.
alter function public.get_due_freight_periods(uuid) rename to get_due_freight_periods_before_store;
revoke all on function public.get_due_freight_periods_before_store(uuid) from public,anon,authenticated,service_role;
create function public.get_due_freight_periods(p_customer uuid)
returns table(freight_period date,first_lot_id uuid,freight_amount numeric)
language sql stable security definer set search_path='' as $$
 with previous as materialized(select * from public.get_due_freight_periods_before_store(p_customer)),
 physical as(select (o.created_at at time zone 'America/Sao_Paulo')::date as shipping_day from public.store_orders o
 where o.customer_id=p_customer and o.payment_status='paid' and o.fulfillment_status<>'fulfilled' and o.shipment_id is null
 and exists(select 1 from public.store_order_items i where i.order_id=o.id and i.delivery_kind='physical') order by o.created_at,o.id limit 1)
 select * from previous union all
 select shipping_day-((extract(dow from shipping_day)::int-2+7)%7),null::uuid,20::numeric from physical
 where not exists(select 1 from previous) and not exists(select 1 from public.available_shipment_freight(p_customer))
 and not exists(select 1 from public.charges where customer_id=p_customer and freight_amount>0 and status in('pending','in_process'));
$$;
revoke all on function public.get_due_freight_periods(uuid) from public,anon,authenticated;
grant execute on function public.get_due_freight_periods(uuid) to service_role;

create function public.box_store_order(p_order_id uuid,p_note text default '',p_declared_value numeric default null)
returns void language plpgsql security definer set search_path='' as $$
declare o public.store_orders%rowtype;cash_value numeric;has_coins boolean;
begin
 if not public.has_staff_write() then raise exception 'Acesso negado.';end if;
 select * into o from public.store_orders where id=p_order_id for update;
 if not found or o.payment_status<>'paid' or o.fulfillment_status<>'processing' or o.shipment_id is not null then raise exception 'Pedido indisponível para separação.';end if;
 if o.boxed_at is not null and o.shipping_declared_value is not null then return;end if;
 select coalesce(sum(quantity*unit_cash),0),coalesce(bool_or(unit_coins>0),false) into cash_value,has_coins from public.store_order_items where order_id=o.id and delivery_kind='physical';
 if not exists(select 1 from public.store_order_items where order_id=o.id and delivery_kind='physical') then raise exception 'Pedido sem produto físico.';end if;
 if has_coins then
  if p_declared_value is null or p_declared_value<=0 or p_declared_value>100000 or p_declared_value<>round(p_declared_value,2) then raise exception 'Informe o valor declarado em reais dos produtos físicos pagos em Caracoins.';end if;
 else p_declared_value:=cash_value;end if;
 if p_declared_value<=0 then raise exception 'Informe o valor declarado dos produtos.';end if;
 update public.store_orders set shipping_declared_value=p_declared_value where id=o.id;
 if o.boxed_at is null then perform public.handle_store_order(p_order_id,'boxed',left(coalesce(p_note,''),500));end if;
end $$;
revoke all on function public.box_store_order(uuid,text,numeric) from public,anon;
grant execute on function public.box_store_order(uuid,text,numeric) to authenticated;

-- Não é permitido contornar a declaração usando a RPC antiga de movimentação.
create function public.require_store_box_value() returns trigger language plpgsql set search_path='' as $$begin
 if new.boxed_at is not null and old.boxed_at is null and new.shipping_declared_value is null then raise exception 'Confira o valor declarado antes de colocar o pedido na caixa.';end if;
 return new;
end $$;
create trigger store_box_value before update of boxed_at on public.store_orders for each row execute function public.require_store_box_value();
revoke all on function public.require_store_box_value() from public,anon,authenticated;

-- Esta função permanece privada, chamada pelas camadas que reservam frete e reposições.
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
 if n=0 and not exists(select 1 from public.shipment_lots sl join public.lots l on l.id=sl.lot_id where sl.shipment_id=s.id and l.customer_id=s.customer_id and l.status='paid') then raise exception 'Nenhum lote ou produto físico disponível para envio.';end if;
 return n;
end $$;
revoke all on function public.bind_store_orders_to_shipment_base(uuid) from public,anon,authenticated,service_role;

create or replace function public.store_order_voucher_summary(p_order uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce((select jsonb_build_object('cash_subtotal',o.cash_subtotal,'discount_cash',o.discount_cash,'voucher_id',o.voucher_id,'voucher_name',v.name,'shipping_declared_value',o.shipping_declared_value)
 from public.store_orders o left join public.customer_store_vouchers v on v.id=o.voucher_id where o.id=p_order and(public.is_admin() or o.customer_id=public.current_customer_id())),'{}'::jsonb);
$$;
revoke all on function public.store_order_voucher_summary(uuid) from public,anon,authenticated;

-- Compra totalmente coberta por voucher não pode gerar lançamento de zero moedas.
create or replace function public.handle_store_order_base(p_order_id uuid,p_status text,p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_order public.store_orders%rowtype;
begin
  if not public.has_staff_write() then raise exception 'Acesso negado.'; end if;
  if p_status not in ('processing','fulfilled','cancelled') then raise exception 'Status inválido.'; end if;
  select * into v_order from public.store_orders where id = p_order_id for update;
  if not found or v_order.payment_status <> 'paid' or v_order.fulfillment_status = 'fulfilled' then
    raise exception 'Somente pedidos pagos e ainda não concluídos podem ser movimentados.';
  end if;
  if p_status = 'cancelled' then
    if v_order.cash_total > 0 then raise exception 'Devolva o Pix no Mercado Pago antes de encerrar este pedido.'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_order.customer_id::text,0));
    if v_order.coins_total>0 then
    insert into public.loyalty_ledger(customer_id,points,kind,store_order_id,note)
    values (v_order.customer_id,v_order.coins_total,'adjustment',v_order.id,'Pedido cancelado pela equipe · ' || v_order.code);
    end if;
    perform r.id from public.loyalty_rewards r join public.store_order_items i on i.reward_id = r.id
    where i.order_id = v_order.id order by r.id for update of r;
    update public.loyalty_rewards r set stock = r.stock + x.quantity from (
      select reward_id,sum(quantity)::integer as quantity from public.store_order_items where order_id = v_order.id and reserved_stock group by reward_id
    ) x where r.id = x.reward_id and r.stock is not null;
    update public.store_orders set payment_status = 'cancelled',resources_released_at = now() where id = v_order.id;
  else
    update public.store_orders set fulfillment_status = p_status where id = v_order.id;
  end if;
  update public.store_orders set admin_note = nullif(left(trim(p_note),500),''),handled_by = auth.uid(),updated_at = now() where id = v_order.id;
end;
$$;
revoke all on function public.handle_store_order_base(uuid,text,text) from public,anon,authenticated,service_role;

create or replace function public.get_store_fulfillment(p_customer uuid default null,p_day date default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'code',o.code,'customer_id',o.customer_id,
    'boxed_at',o.boxed_at,'shipping_declared_value',o.shipping_declared_value,'shipment_id',o.shipment_id,'fulfillment_status',o.fulfillment_status,'reconciliation_error',o.reconciliation_error,
    'physical',exists(select 1 from public.store_order_items i where i.order_id=o.id and i.delivery_kind='physical'),
    'items',(select jsonb_agg(jsonb_build_object('name',i.name,'quantity',i.quantity,'delivery_kind',i.delivery_kind)) from public.store_order_items i where i.order_id=o.id)) order by o.created_at,o.id)
    from public.store_orders o where (p_customer is null or o.customer_id=p_customer)
      and (p_day is null or (o.payment_status='paid' and o.fulfillment_status<>'fulfilled' and o.shipment_id is null
        and o.created_at<((p_day+1)::timestamp at time zone 'America/Sao_Paulo')))), '[]'::jsonb);
end; $$;
revoke all on function public.get_store_fulfillment(uuid,date) from public,anon;
grant execute on function public.get_store_fulfillment(uuid,date) to authenticated;


-- Abertura auditável e restrita ao dono. Nada é aberto pela migration.
grant select on public.store_commerce_settings to authenticated;
create policy store_commerce_read on public.store_commerce_settings for select to authenticated using(public.is_admin() or public.current_customer_id() is not null);
create table public.store_commerce_events(id bigint generated always as identity primary key,enabled boolean not null,note text not null,actor uuid,created_at timestamptz not null default now());
alter table public.store_commerce_events enable row level security;
revoke all on public.store_commerce_events from public,anon,authenticated;
grant select on public.store_commerce_events to authenticated;
create policy store_commerce_events_read on public.store_commerce_events for select to authenticated using(public.is_owner());
create function public.set_store_commerce_enabled(p_enabled boolean,p_note text) returns void language plpgsql security definer set search_path='' as $$begin
 if not public.is_owner() then raise exception 'Acesso negado.';end if;
 if p_enabled is null or length(trim(coalesce(p_note,''))) not between 5 and 500 then raise exception 'Informe o motivo da mudança.';end if;
 perform 1 from public.store_commerce_settings where id for update;
 if p_enabled then
  if not exists(select 1 from public.loyalty_settings where id and active) then raise exception 'Ative o programa antes de abrir as compras.';end if;
  if exists(select 1 from public.loyalty_rewards where active and not archived and(mixed_cash_price is not null or mixed_points_cost is not null or(cash_price is not null and points_cost is not null))) then raise exception 'Revise os produtos antigos com preços combinados antes de abrir.';end if;
  if not exists(select 1 from public.loyalty_rewards where active and not archived and internal_cost is not null and(cash_price>0 or points_cost>0) and(stock is null or stock>0)) then raise exception 'Cadastre um produto disponível com custo e preço antes de abrir.';end if;
 end if;
 update public.store_commerce_settings set purchases_enabled=p_enabled where id;
 insert into public.store_commerce_events(enabled,note,actor) values(p_enabled,trim(p_note),auth.uid());
end $$;
revoke all on function public.set_store_commerce_enabled(boolean,text) from public,anon;
grant execute on function public.set_store_commerce_enabled(boolean,text) to authenticated;

-- Lease por cliente: dois operadores não emitem duas etiquetas simultaneamente.
create table public.shipment_emission_leases(customer_id uuid primary key references public.customers(id),token uuid not null,expires_at timestamptz not null);
alter table public.shipment_emission_leases enable row level security;
revoke all on public.shipment_emission_leases from public,anon,authenticated;
grant all on public.shipment_emission_leases to service_role;
create function public.claim_shipment_emission(p_customer uuid,p_token uuid) returns boolean language plpgsql security definer set search_path='' as $$begin
 insert into public.shipment_emission_leases values(p_customer,p_token,now()+interval '5 minutes') on conflict(customer_id) do update set token=excluded.token,expires_at=excluded.expires_at where shipment_emission_leases.expires_at<now();return found;
end $$;
revoke all on function public.claim_shipment_emission(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_shipment_emission(uuid,uuid) to service_role;
commit;
