-- Produtos em uma moeda; vouchers resgatados separadamente em Caracoins.
-- Mantém a loja fechada. Não modifica preços nem pedidos antigos.
begin;
create table public.store_commerce_settings(id boolean primary key default true check(id),purchases_enabled boolean not null default false);
insert into public.store_commerce_settings values(true,false);
alter table public.store_commerce_settings enable row level security;
revoke all on public.store_commerce_settings from public,anon,authenticated;
grant all on public.store_commerce_settings to service_role;

create table public.store_voucher_templates(
 id uuid primary key default gen_random_uuid(),name text not null check(length(btrim(name)) between 2 and 120),
 coins_cost numeric(12,2) check(coins_cost>0),discount_cash numeric(12,2) check(discount_cash>0),
 min_purchase numeric(12,2) not null default 0 check(min_purchase>=0),validity_days integer not null default 30 check(validity_days between 1 and 365),
 eligible_product_ids uuid[] not null default '{}',max_redemptions integer check(max_redemptions>0),max_per_customer integer not null default 1 check(max_per_customer>0),
 active boolean not null default false,updated_at timestamptz not null default now(),created_at timestamptz not null default now(),
 check(not active or (coins_cost is not null and discount_cash is not null))
);
create table public.customer_store_vouchers(
 id uuid primary key default gen_random_uuid(),customer_id uuid not null references public.customers(id),template_id uuid not null references public.store_voucher_templates(id),
 request_key uuid not null,name text not null,coins_paid numeric(12,2) not null check(coins_paid>0),discount_cash numeric(12,2) not null check(discount_cash>0),
 min_purchase numeric(12,2) not null,eligible_product_ids uuid[] not null,expires_at timestamptz not null,
 status text not null default 'available' check(status in('available','reserved','used')),
 order_id uuid unique references public.store_orders(id),created_at timestamptz not null default now(),
 unique(customer_id,request_key),check((status='available' and order_id is null) or(status<>'available' and order_id is not null))
);
create index customer_voucher_wallet on public.customer_store_vouchers(customer_id,status,expires_at);
create index voucher_template_redemptions on public.customer_store_vouchers(template_id,customer_id);
alter table public.store_voucher_templates enable row level security;
alter table public.customer_store_vouchers enable row level security;
revoke all on public.store_voucher_templates,public.customer_store_vouchers from public,anon,authenticated;
grant select on public.store_voucher_templates,public.customer_store_vouchers to authenticated;
grant all on public.store_voucher_templates,public.customer_store_vouchers to service_role;
create policy voucher_templates_read on public.store_voucher_templates for select to authenticated using(public.is_admin() or active);
create policy voucher_wallet_read on public.customer_store_vouchers for select to authenticated using(public.is_admin() or customer_id=public.current_customer_id());

alter table public.loyalty_ledger add column voucher_id uuid references public.customer_store_vouchers(id);
alter table public.loyalty_ledger drop constraint loyalty_ledger_source_check;
alter table public.loyalty_ledger add constraint loyalty_ledger_source_check check(
 (kind='earned' and points>0 and lot_id is not null and num_nonnulls(redemption_id,store_order_id,voucher_id)=0)
 or(kind='spent' and points<0 and lot_id is null and num_nonnulls(redemption_id,store_order_id,voucher_id)=1)
 or(kind='reversal' and lot_id is not null and num_nonnulls(redemption_id,store_order_id,voucher_id)=0)
 or(kind='adjustment' and lot_id is null and redemption_id is null and voucher_id is null)
);
create unique index voucher_ledger_once on public.loyalty_ledger(voucher_id) where voucher_id is not null;
alter table public.store_orders add column voucher_id uuid references public.customer_store_vouchers(id),add column discount_cash numeric(12,2) not null default 0 check(discount_cash>=0),add column cash_subtotal numeric(12,2) not null default 0;
update public.store_orders set cash_subtotal=cash_total;
do $$ declare c record;begin
 for c in select conname from pg_constraint where conrelid='public.store_orders'::regclass and contype='c' and pg_get_constraintdef(oid) like '%cash_total >%' loop
 execute format('alter table public.store_orders drop constraint %I',c.conname);end loop;
end $$;
alter table public.store_orders add constraint store_order_value_check check(cash_total>0 or coins_total>0 or(discount_cash>0 and voucher_id is not null));

create function public.validate_store_single_currency() returns trigger language plpgsql set search_path='' as $$begin
 if TG_OP='UPDATE' and not new.active and new.cash_price is not distinct from old.cash_price and new.points_cost is not distinct from old.points_cost and new.mixed_cash_price is not distinct from old.mixed_cash_price and new.mixed_points_cost is not distinct from old.mixed_points_cost then return new;end if;
 if new.mixed_cash_price is not null or new.mixed_points_cost is not null or(new.cash_price is not null and new.points_cost is not null) then
 raise exception 'Escolha apenas reais ou Caracoins. Para desconto, cadastre um voucher.';end if;return new;end $$;
create trigger store_single_currency before insert or update of cash_price,points_cost,mixed_cash_price,mixed_points_cost,active on public.loyalty_rewards for each row execute function public.validate_store_single_currency();
revoke all on function public.validate_store_single_currency() from public,anon,authenticated;

create function public.redeem_store_voucher(p_template uuid,p_request_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare customer uuid:=public.current_customer_id();t public.store_voucher_templates%rowtype;v uuid;balance numeric;
begin
 if customer is null or p_request_key is null then raise exception 'Cliente não autenticado.';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(customer::text,0));
 select id into v from public.customer_store_vouchers where customer_id=customer and request_key=p_request_key;if found then return v;end if;
 if not exists(select 1 from public.store_commerce_settings where id and purchases_enabled) or not exists(select 1 from public.loyalty_settings where id and active) then raise exception 'A loja está em prévia.';end if;
 select * into t from public.store_voucher_templates where id=p_template and active for update;
 if not found then raise exception 'Voucher indisponível.';end if;
 if t.max_redemptions is not null and (select count(*) from public.customer_store_vouchers where template_id=t.id)>=t.max_redemptions then raise exception 'Limite de vouchers atingido.';end if;
 if (select count(*) from public.customer_store_vouchers where template_id=t.id and customer_id=customer)>=t.max_per_customer then raise exception 'Você já atingiu o limite deste voucher.';end if;
 select coalesce(sum(points),0) into balance from public.loyalty_ledger where customer_id=customer;
 if balance<t.coins_cost then raise exception 'Saldo de Caracoins insuficiente.';end if;
 insert into public.customer_store_vouchers(customer_id,template_id,request_key,name,coins_paid,discount_cash,min_purchase,eligible_product_ids,expires_at)
 values(customer,t.id,p_request_key,t.name,t.coins_cost,t.discount_cash,t.min_purchase,t.eligible_product_ids,now()+make_interval(days=>t.validity_days)) returning id into v;
 insert into public.loyalty_ledger(customer_id,points,kind,voucher_id,note) values(customer,-t.coins_cost,'spent',v,'Resgate de voucher · '||t.name);
 return v;
end $$;
revoke all on function public.redeem_store_voucher(uuid,uuid) from public,anon;
grant execute on function public.redeem_store_voucher(uuid,uuid) to authenticated;

-- A função original de 0033 continua privada, inclusive para service_role.
create function public.checkout_store_cart_v2(p_request_key uuid,p_items jsonb,p_voucher uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare customer uuid:=public.current_customer_id();v public.customer_store_vouchers%rowtype;o public.store_orders%rowtype;order_id uuid;eligible numeric;discount numeric;
begin
 if customer is null or p_request_key is null then raise exception 'Cliente não autenticado.';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(customer::text,0));
 select id into order_id from public.store_orders where customer_id=customer and request_key=p_request_key;if found then return order_id;end if;
 if not exists(select 1 from public.store_commerce_settings where id and purchases_enabled) then raise exception 'A loja está em prévia.';end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'Carrinho inválido.';end if;
 if exists(select 1 from jsonb_to_recordset(p_items) x(mode text) where mode is null or mode not in('cash','coins'))
 or(select count(distinct x.mode) from jsonb_to_recordset(p_items)x(mode text))<>1 then raise exception 'Separe compras em reais e resgates em Caracoins.';end if;
 perform r.id from public.loyalty_rewards r where r.id in(select x.reward_id from jsonb_to_recordset(p_items)x(reward_id uuid)) order by r.id for update;
 if exists(select 1 from public.loyalty_rewards r join jsonb_to_recordset(p_items)x(reward_id uuid,mode text) on r.id=x.reward_id
 where r.mixed_cash_price is not null or r.mixed_points_cost is not null or(r.cash_price is not null and r.points_cost is not null)) then raise exception 'Um produto precisa de revisão de preço pela equipe.';end if;
 if p_voucher is not null then
  if exists(select 1 from jsonb_to_recordset(p_items)x(mode text) where mode<>'cash') then raise exception 'Voucher vale apenas em produtos pagos em reais.';end if;
  select * into v from public.customer_store_vouchers where id=p_voucher and customer_id=customer for update;
  if not found or v.status<>'available' or v.expires_at<=now() then raise exception 'Voucher indisponível ou expirado.';end if;
 end if;
 order_id:=public.checkout_store_cart_live(p_request_key,p_items);
 select * into o from public.store_orders where id=order_id;
 if p_voucher is not null then
  select coalesce(sum(unit_cash*quantity),0) into eligible from public.store_order_items where store_order_items.order_id=o.id and(cardinality(v.eligible_product_ids)=0 or reward_id=any(v.eligible_product_ids));
  if eligible<=0 or eligible<v.min_purchase then raise exception 'Compra não atende ao valor mínimo ou aos produtos do voucher.';end if;
  discount:=least(v.discount_cash,eligible);
  update public.store_orders set cash_subtotal=o.cash_total,voucher_id=v.id,discount_cash=discount,cash_total=o.cash_total-discount,
   payment_status=case when o.cash_total-discount=0 then 'paid' else payment_status end,paid_at=case when o.cash_total-discount=0 then now() else paid_at end where id=o.id;
  update public.customer_store_vouchers set status=case when o.cash_total-discount=0 then 'used' else 'reserved' end,order_id=o.id where id=v.id;
 else update public.store_orders set cash_subtotal=cash_total where id=o.id;end if;
 return order_id;
end $$;
revoke all on function public.checkout_store_cart_v2(uuid,jsonb,uuid) from public,anon;
grant execute on function public.checkout_store_cart_v2(uuid,jsonb,uuid) to authenticated;

create function public.sync_store_voucher_status() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.voucher_id is null then return new;end if;
 if new.payment_status in('paid','partially_refunded','payment_review') then
  update public.customer_store_vouchers set status='used' where id=new.voucher_id and order_id=new.id;
 elsif new.payment_status in('cancelled','expired','failed','refunded') and old.payment_status in('creating','pending') then
  update public.customer_store_vouchers set status='available',order_id=null where id=new.voucher_id and order_id=new.id and status='reserved';
 end if;return new;end $$;
create trigger store_voucher_payment after update of payment_status on public.store_orders for each row execute function public.sync_store_voucher_status();
revoke all on function public.sync_store_voucher_status() from public,anon,authenticated;
-- Totais e desconto também aparecem nos históricos, sem alterar snapshots antigos.
create function public.store_order_voucher_summary(p_order uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce((select jsonb_build_object('cash_subtotal',o.cash_subtotal,'discount_cash',o.discount_cash,'voucher_id',o.voucher_id,'voucher_name',v.name)
 from public.store_orders o left join public.customer_store_vouchers v on v.id=o.voucher_id where o.id=p_order and(public.is_admin() or o.customer_id=public.current_customer_id())),'{}'::jsonb);
$$;
revoke all on function public.store_order_voucher_summary(uuid) from public,anon,authenticated;
alter function public.get_admin_order_history(text,text,text,date,date,integer,integer) rename to get_admin_order_history_pre_vouchers;
revoke all on function public.get_admin_order_history_pre_vouchers(text,text,text,date,date,integer,integer) from public,anon,authenticated;
create function public.get_admin_order_history(p_query text default '',p_status text default 'all',p_source text default 'all',p_from date default null,p_to date default null,p_page integer default 1,p_size integer default 20)
returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 if not public.is_admin() then raise exception 'Acesso negado.';end if;
 result:=public.get_admin_order_history_pre_vouchers(p_query,p_status,p_source,p_from,p_to,p_page,p_size);
 return jsonb_set(result,'{items}',coalesce((select jsonb_agg(item||case when item->>'source'='store' then public.store_order_voucher_summary((item->>'id')::uuid) else '{}'::jsonb end order by ord) from jsonb_array_elements(result->'items') with ordinality r(item,ord)),'[]'::jsonb));
end $$;
revoke all on function public.get_admin_order_history(text,text,text,date,date,integer,integer) from public,anon;
grant execute on function public.get_admin_order_history(text,text,text,date,date,integer,integer) to authenticated;
alter function public.get_customer_order_history(text,date,date,integer) rename to get_customer_order_history_pre_vouchers;
revoke all on function public.get_customer_order_history_pre_vouchers(text,date,date,integer) from public,anon,authenticated;
create function public.get_customer_order_history(p_status text default 'all',p_from date default null,p_to date default null,p_page integer default 1)
returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 if public.current_customer_id() is null then raise exception 'Acesso negado.';end if;
 result:=public.get_customer_order_history_pre_vouchers(p_status,p_from,p_to,p_page);
 return jsonb_set(result,'{items}',coalesce((select jsonb_agg(item||case when item->>'source'='store' then public.store_order_voucher_summary((item->>'id')::uuid) else '{}'::jsonb end order by ord) from jsonb_array_elements(result->'items') with ordinality r(item,ord)),'[]'::jsonb));
end $$;
revoke all on function public.get_customer_order_history(text,date,date,integer) from public,anon;
grant execute on function public.get_customer_order_history(text,date,date,integer) to authenticated;
alter function public.get_store_dashboard(date,date) rename to get_store_dashboard_pre_vouchers;
revoke all on function public.get_store_dashboard_pre_vouchers(date,date) from public,anon,authenticated;
create function public.get_store_dashboard(p_from date default null,p_to date default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;issued bigint;coins numeric;discounts numeric;date_from date:=coalesce(p_from,(now() at time zone 'America/Sao_Paulo')::date-29);date_to date:=coalesce(p_to,(now() at time zone 'America/Sao_Paulo')::date);
begin
 if not public.is_admin() then raise exception 'Acesso negado.';end if;
 date_from:=coalesce(p_from,date_to-29);
 result:=public.get_store_dashboard_pre_vouchers(p_from,p_to);
 select count(*),coalesce(sum(coins_paid),0) into issued,coins from public.customer_store_vouchers
 where created_at >= (date_from::timestamp at time zone 'America/Sao_Paulo') and created_at < ((date_to+1)::timestamp at time zone 'America/Sao_Paulo');
 select coalesce(sum(discount_cash),0) into discounts from public.store_orders where payment_status='paid' and paid_at >= (date_from::timestamp at time zone 'America/Sao_Paulo') and paid_at < ((date_to+1)::timestamp at time zone 'America/Sao_Paulo');
 result:=jsonb_set(result,'{metrics,coins}',to_jsonb(coalesce((result->'metrics'->>'coins')::numeric,0)+coins));
 return result||jsonb_build_object('vouchers',jsonb_build_object('redeemed',issued,'coins_spent',coins,'discounts_used',discounts));
end $$;
revoke all on function public.get_store_dashboard(date,date) from public,anon;
grant execute on function public.get_store_dashboard(date,date) to authenticated;
commit;
