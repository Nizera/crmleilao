-- Frete único do pacote, reconhecido e cobrado no checkout da loja.
begin;
alter table public.store_orders add column freight_amount numeric(12,2) not null default 0 check(freight_amount in(0,20));
create index store_paid_freight on public.store_orders(customer_id,paid_at) where freight_amount>0;
create table public.shipment_store_freight_usage(order_id uuid primary key references public.store_orders(id),shipment_id uuid not null unique references public.shipments(id),customer_id uuid not null references public.customers(id));
alter table public.shipment_store_freight_usage enable row level security;
revoke all on public.shipment_store_freight_usage from public,anon,authenticated;
grant all on public.shipment_store_freight_usage to service_role;

create function public.available_store_freight(p_customer uuid) returns table(order_id uuid) language sql stable security definer set search_path='' as $$
 select o.id from public.store_orders o where o.customer_id=p_customer and o.payment_status='paid' and o.freight_amount>0
 and not exists(select 1 from public.shipment_store_freight_usage u join public.shipments s on s.id=u.shipment_id where u.order_id=o.id and s.status<>'cancelled')
 order by o.paid_at nulls last,o.created_at,o.id;
$$;
revoke all on function public.available_store_freight(uuid) from public,anon,authenticated;
grant execute on function public.available_store_freight(uuid) to service_role;

create function public.store_freight_quote_for(p_customer uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare code text;order_id uuid;
begin
 if exists(select 1 from public.available_shipment_freight(p_customer)) or exists(select 1 from public.available_store_freight(p_customer)) then return jsonb_build_object('status','paid','amount',0);end if;
 select c.code into code from public.charges c where c.customer_id=p_customer and c.freight_amount>0 and c.status in('pending','in_process') order by c.created_at limit 1;
 if code is not null then return jsonb_build_object('status','awaiting','amount',0,'code',code,'source','auction');end if;
 select o.code,o.id into code,order_id from public.store_orders o where o.customer_id=p_customer and o.freight_amount>0 and o.payment_status in('creating','pending','partially_refunded','payment_review') order by o.created_at limit 1;
 if order_id is not null then return jsonb_build_object('status','awaiting','amount',0,'code',code,'source','store','storeOrderId',order_id);end if;
 return jsonb_build_object('status','due','amount',20);
end $$;
revoke all on function public.store_freight_quote_for(uuid) from public,anon,authenticated;
create function public.get_store_freight_quote() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare customer uuid:=public.current_customer_id();begin
 if customer is null then raise exception 'Acesso negado.';end if;
 return public.store_freight_quote_for(customer);
end $$;
revoke all on function public.get_store_freight_quote() from public,anon;
grant execute on function public.get_store_freight_quote() to authenticated;

alter function public.checkout_store_cart_v2(uuid,jsonb,uuid) rename to checkout_store_cart_before_freight;
revoke all on function public.checkout_store_cart_before_freight(uuid,jsonb,uuid) from public,anon,authenticated,service_role;
create function public.checkout_store_cart_v2(p_request_key uuid,p_items jsonb,p_voucher uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare customer uuid:=public.current_customer_id();existing uuid;physical boolean;quote jsonb;fee numeric:=0;expected numeric;o public.store_orders%rowtype;
begin
 if customer is null or p_request_key is null then raise exception 'Cliente não autenticado.';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(customer::text,0));
 select id into existing from public.store_orders where customer_id=customer and request_key=p_request_key;if found then return existing;end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'Carrinho inválido.';end if;
 select exists(select 1 from jsonb_to_recordset(p_items)x(reward_id uuid) join public.loyalty_rewards r on r.id=x.reward_id where r.delivery_kind='physical') into physical;
 if physical then
  quote:=public.store_freight_quote_for(customer);
  if quote->>'status'='awaiting' then raise exception 'O frete já está em um Pix pendente ou em análise. Confira esse pagamento antes de comprar.';end if;
  fee:=(quote->>'amount')::numeric;
 end if;
 expected:=(p_items->0->>'expected_freight_amount')::numeric;
 if expected is null or expected not in(0,20) or expected<>fee then raise exception 'O frete mudou. Confira o total atualizado e confirme novamente.';end if;
 existing:=public.checkout_store_cart_before_freight(p_request_key,p_items,p_voucher);
 select * into o from public.store_orders where id=existing for update;
 if fee>0 then
  -- Vouchers descontam só produtos; moedas podem pagar produtos, nunca o frete.
  update public.store_orders set freight_amount=fee,cash_total=cash_total+fee,payment_status='creating',paid_at=null,updated_at=now() where id=o.id;
  update public.customer_store_vouchers set status='reserved' where id=o.voucher_id and order_id=o.id;
 end if;
 return existing;
end $$;
revoke all on function public.checkout_store_cart_v2(uuid,jsonb,uuid) from public,anon;
grant execute on function public.checkout_store_cart_v2(uuid,jsonb,uuid) to authenticated;

-- Uma cobrança da loja reserva o frete, impedindo criar outro Pix de frete nos lotes.
alter function public.get_due_freight_periods(uuid) rename to get_due_freight_periods_before_checkout;
revoke all on function public.get_due_freight_periods_before_checkout(uuid) from public,anon,authenticated,service_role;
create function public.get_due_freight_periods(p_customer uuid) returns table(freight_period date,first_lot_id uuid,freight_amount numeric) language sql stable security definer set search_path='' as $$
 select * from public.get_due_freight_periods_before_checkout(p_customer) where not exists(select 1 from public.available_store_freight(p_customer))
 and not exists(select 1 from public.store_orders where customer_id=p_customer and freight_amount>0 and payment_status in('creating','pending','partially_refunded','payment_review'));
$$;
revoke all on function public.get_due_freight_periods(uuid) from public,anon,authenticated;
grant execute on function public.get_due_freight_periods(uuid) to service_role;

create or replace function public.claim_shipment_freight(p_shipment uuid) returns void language plpgsql security definer set search_path='' as $$
declare s public.shipments%rowtype;credit uuid;store_credit uuid;
begin
 select * into s from public.shipments where id=p_shipment for update;
 if not found or s.status<>'pending' then raise exception 'Envio indisponível.';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s.customer_id::text,0));
 if exists(select 1 from public.shipment_freight_usage u join public.charges c on c.id=u.charge_id where u.shipment_id=s.id and c.status='approved')
 or exists(select 1 from public.shipment_store_freight_usage u join public.store_orders o on o.id=u.order_id where u.shipment_id=s.id and o.payment_status='paid') then return;end if;
 select f.charge_id into credit from public.available_shipment_freight(s.customer_id) f limit 1;
 if credit is not null then
  perform 1 from public.charges where id=credit and status='approved' for update;
  if not found then raise exception 'O pagamento do frete mudou. Atualize antes de emitir.';end if;
  insert into public.shipment_freight_usage(charge_id,shipment_id,customer_id) values(credit,s.id,s.customer_id) on conflict(charge_id) do update set shipment_id=excluded.shipment_id,created_at=now()
  where exists(select 1 from public.shipments old where old.id=shipment_freight_usage.shipment_id and old.status='cancelled');
 else
  select f.order_id into store_credit from public.available_store_freight(s.customer_id) f limit 1;
  if store_credit is null then raise exception 'O frete de R$20 deste envio ainda não foi pago.';end if;
  perform 1 from public.store_orders where id=store_credit and payment_status='paid' and freight_amount>0 for update;
  if not found then raise exception 'O pagamento do frete mudou. Atualize antes de emitir.';end if;
  insert into public.shipment_store_freight_usage(order_id,shipment_id,customer_id) values(store_credit,s.id,s.customer_id) on conflict(order_id) do update set shipment_id=excluded.shipment_id
  where exists(select 1 from public.shipments old where old.id=shipment_store_freight_usage.shipment_id and old.status='cancelled');
 end if;
 if not found then raise exception 'O frete já foi utilizado em outro envio.';end if;
end $$;
revoke all on function public.claim_shipment_freight(uuid) from public,anon,authenticated;
grant execute on function public.claim_shipment_freight(uuid) to service_role;
create or replace function public.assert_shipment_freight(p_shipment uuid) returns void language plpgsql security definer set search_path='' as $$begin
 if not exists(select 1 from public.shipment_freight_usage u join public.charges c on c.id=u.charge_id where u.shipment_id=p_shipment and c.status='approved' and c.freight_amount>0)
 and not exists(select 1 from public.shipment_store_freight_usage u join public.store_orders o on o.id=u.order_id where u.shipment_id=p_shipment and o.payment_status='paid' and o.freight_amount>0) then raise exception 'Confira o pagamento do frete antes de pagar esta etiqueta.';end if;
end $$;

create or replace function public.shipping_freight_states(p_customers uuid[]) returns table(customer_id uuid,status text) language sql stable security definer set search_path='' as $$
 select customer,case
 when exists(select 1 from public.available_shipment_freight(customer)) or exists(select 1 from public.available_store_freight(customer)) then 'paid'
 when exists(select 1 from public.charges where customer_id=customer and freight_amount>0 and status in('pending','in_process')) or exists(select 1 from public.store_orders where customer_id=customer and freight_amount>0 and payment_status in('creating','pending','partially_refunded','payment_review')) then 'awaiting'
 when exists(select 1 from public.get_due_freight_periods(customer)) then 'due'
 when exists(select 1 from public.shipment_freight_usage u join public.shipments s on s.id=u.shipment_id join public.charges c on c.id=u.charge_id where u.customer_id=customer and s.status in('pending','released') and c.status='approved')
 or exists(select 1 from public.shipment_store_freight_usage u join public.shipments s on s.id=u.shipment_id join public.store_orders o on o.id=u.order_id where u.customer_id=customer and s.status in('pending','released') and o.payment_status='paid') then 'paid' else 'none' end from unnest(p_customers) customer;
$$;

create or replace function public.get_customer_freight_summary() returns jsonb language plpgsql security definer set search_path='' as $$
declare customer uuid:=public.current_customer_id();quote jsonb;period date;
begin
 if customer is null then raise exception 'Acesso negado.';end if;
 period:=(now() at time zone 'America/Sao_Paulo')::date;period:=period-((extract(dow from period)::int-2+7)%7);
 quote:=public.store_freight_quote_for(customer);
 if quote->>'status'='due' and not exists(select 1 from public.get_due_freight_periods(customer)) then return jsonb_build_object('status','none','amount',20,'periodStart',period);end if;
 return jsonb_build_object('status',quote->>'status','amount',20,'periodStart',period,'chargeCode',quote->>'code','storeOrderId',quote->>'storeOrderId');
end $$;

-- Não use o crédito do pacote para despachar enquanto a compra física está pendente.
create or replace function public.assert_store_shipping_ready(p_customer uuid,p_day date) returns void language plpgsql security definer set search_path='' as $$begin
 if p_day is null then raise exception 'Informe a data de envio.';end if;
 if exists(select 1 from public.store_orders o where o.customer_id=p_customer and o.shipment_id is null and o.payment_status in('creating','pending','partially_refunded','payment_review')
 and o.created_at<((p_day+1)::timestamp at time zone 'America/Sao_Paulo') and exists(select 1 from public.store_order_items i where i.order_id=o.id and i.delivery_kind='physical')) then raise exception 'Há compra física da loja com pagamento pendente ou em análise. Confira antes de emitir.';end if;
 if exists(select 1 from public.store_orders o where o.customer_id=p_customer and o.payment_status='paid' and o.fulfillment_status<>'fulfilled' and o.shipment_id is null
 and o.created_at<((p_day+1)::timestamp at time zone 'America/Sao_Paulo') and o.boxed_at is null and exists(select 1 from public.store_order_items i where i.order_id=o.id and i.delivery_kind='physical')) then raise exception 'Há produtos da loja pagos aguardando separação. Coloque-os na caixa antes de emitir.';end if;
end $$;

-- O crédito pago na loja também pode acompanhar o pagamento de novos lotes.
create or replace function public.require_lot_period_freight() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.charge_id is null or new.charge_id is not distinct from old.charge_id then return new;end if;
 if not exists(select 1 from public.available_shipment_freight(new.customer_id)) and not exists(select 1 from public.available_store_freight(new.customer_id)) and not exists(select 1 from public.charge_freight_items where customer_id=new.customer_id and charge_id=new.charge_id and status in('pending','in_process','approved')) then raise exception 'O frete de R$20 do envio acumulado deve acompanhar o pagamento dos lotes.';end if;
 return new;
end $$;

create or replace function public.store_order_voucher_summary(p_order uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce((select jsonb_build_object('cash_subtotal',o.cash_subtotal,'discount_cash',o.discount_cash,'voucher_id',o.voucher_id,'voucher_name',v.name,'shipping_declared_value',o.shipping_declared_value,'freight_amount',o.freight_amount)
 from public.store_orders o left join public.customer_store_vouchers v on v.id=o.voucher_id where o.id=p_order and(public.is_admin() or o.customer_id=public.current_customer_id())),'{}'::jsonb);
$$;

create or replace view public.charge_freight_periods as
 select f.charge_id as id,f.customer_id,f.freight_period,f.freight_amount,c.code,c.status,c.expires_at,c.paid_at,c.created_at from public.charge_freight_items f join public.charges c on c.id=f.charge_id
 union all select o.id,o.customer_id,((o.created_at at time zone 'America/Sao_Paulo')::date-((extract(dow from o.created_at at time zone 'America/Sao_Paulo')::int-2+7)%7)),o.freight_amount::numeric(10,2),o.code,
 (jsonb_populate_record(null::public.charges,jsonb_build_object('status',case when o.payment_status='paid' then 'approved' when o.payment_status in('creating','pending','partially_refunded','payment_review') then 'pending' when o.payment_status in('cancelled','expired') then o.payment_status else 'rejected' end))).status,o.expires_at,o.paid_at,o.created_at from public.store_orders o where o.freight_amount>0;
revoke all on public.charge_freight_periods from public,anon,authenticated;
grant select on public.charge_freight_periods to service_role;
-- Faturamento da loja separa o frete do valor dos produtos.
alter function public.get_store_dashboard(date,date) rename to get_store_dashboard_before_checkout_freight;
revoke all on function public.get_store_dashboard_before_checkout_freight(date,date) from public,anon,authenticated,service_role;
create function public.get_store_dashboard(p_from date default null,p_to date default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;freight numeric;chart jsonb;
begin
 if not public.is_admin() then raise exception 'Acesso negado.';end if;
 p_to:=coalesce(p_to,(now() at time zone 'America/Sao_Paulo')::date);p_from:=coalesce(p_from,p_to-29);
 result:=public.get_store_dashboard_before_checkout_freight(p_from,p_to);
 select coalesce(sum(freight_amount),0) into freight from public.store_orders where payment_status='paid'
 and coalesce(paid_at,created_at)>=(p_from::timestamp at time zone 'America/Sao_Paulo') and coalesce(paid_at,created_at)<((p_to+1)::timestamp at time zone 'America/Sao_Paulo');
 result:=jsonb_set(result,'{metrics,cash}',to_jsonb(coalesce((result->'metrics'->>'cash')::numeric,0)-freight));
 result:=jsonb_set(result,'{metrics,freight_received}',to_jsonb(freight));
 with fees as(select (coalesce(paid_at,created_at) at time zone 'America/Sao_Paulo')::date as freight_day,sum(freight_amount) amount from public.store_orders where payment_status='paid' and freight_amount>0
 and coalesce(paid_at,created_at)>=(p_from::timestamp at time zone 'America/Sao_Paulo') and coalesce(paid_at,created_at)<((p_to+1)::timestamp at time zone 'America/Sao_Paulo') group by 1)
 select coalesce(jsonb_agg(item||jsonb_build_object('cash',(item->>'cash')::numeric-coalesce(f.amount,0)) order by ord),'[]'::jsonb) into chart
 from jsonb_array_elements(result->'chart') with ordinality c(item,ord) left join fees f on f.freight_day=(item->>'day')::date;
 return jsonb_set(result,'{chart}',chart);
end $$;
revoke all on function public.get_store_dashboard(date,date) from public,anon;
grant execute on function public.get_store_dashboard(date,date) to authenticated;
commit;
