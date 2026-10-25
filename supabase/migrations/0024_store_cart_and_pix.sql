-- Carrinho da loja: reservas atômicas, preços por modalidade e Pix independente dos lotes.
begin;

alter table public.loyalty_rewards
  add column cash_price numeric(12,2) check (cash_price > 0),
  add column mixed_cash_price numeric(12,2) check (mixed_cash_price > 0),
  add column mixed_points_cost integer check (mixed_points_cost > 0),
  add constraint loyalty_reward_mixed_pair check ((mixed_cash_price is null) = (mixed_points_cost is null));

create or replace function public.validate_loyalty_reward()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.active and (new.internal_cost is null or
    (new.points_cost is null and new.cash_price is null and new.mixed_cash_price is null)) then
    raise exception 'Para publicar, informe custo interno e ao menos uma modalidade de preço.';
  end if;
  if exists (select 1 from public.loyalty_settings where id = true and active)
     and (not new.active or new.internal_cost is null or
       (new.points_cost is null and new.cash_price is null and new.mixed_cash_price is null))
     and not exists (select 1 from public.loyalty_rewards where active and id <> new.id
       and internal_cost is not null and (points_cost is not null or cash_price is not null or mixed_cash_price is not null)) then
    raise exception 'Desative o programa antes de remover o último produto publicado.';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
drop trigger loyalty_rewards_validate on public.loyalty_rewards;
create trigger loyalty_rewards_validate before insert or update on public.loyalty_rewards
for each row execute function public.validate_loyalty_reward();

create or replace function public.save_loyalty_settings(
  p_active boolean, p_points_per_real numeric, p_ranking_enabled boolean, p_note text default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_staff_write() then raise exception 'Acesso negado.'; end if;
  if p_active and not exists (select 1 from public.loyalty_rewards where active
    and internal_cost is not null and (points_cost is not null or cash_price is not null or mixed_cash_price is not null)) then
    raise exception 'Cadastre um produto ativo com preço e custo interno.';
  end if;
  insert into public.loyalty_settings(id, active, points_per_real, points_expire_days, ranking_enabled, updated_by, updated_at)
  values (true, p_active, null, null, p_ranking_enabled, auth.uid(), now())
  on conflict (id) do update set active = excluded.active, points_per_real = null,
    points_expire_days = null, ranking_enabled = excluded.ranking_enabled,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into public.loyalty_settings_history(active, ranking_enabled, note, changed_by)
  values (p_active, p_ranking_enabled, nullif(left(p_note,500),''), auth.uid());
end;
$$;

create table public.store_orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('LJ-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
  customer_id uuid not null references public.customers(id) on delete restrict,
  request_key uuid not null,
  external_reference text not null unique,
  cash_total numeric(12,2) not null check (cash_total >= 0),
  coins_total numeric(12,2) not null check (coins_total >= 0),
  payment_status text not null check (payment_status in ('creating','pending','paid','cancelled','expired','failed','refunded','partially_refunded','payment_review')),
  fulfillment_status text not null default 'awaiting' check (fulfillment_status in ('awaiting','processing','fulfilled')),
  mp_order_id text unique,
  qr_code text,
  qr_code_base64 text,
  ticket_url text,
  expires_at timestamptz,
  paid_at timestamptz,
  resources_released_at timestamptz,
  admin_note text check (char_length(admin_note) <= 500),
  handled_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(customer_id, request_key),
  check (cash_total > 0 or coins_total > 0)
);
create unique index store_one_open_order_per_customer on public.store_orders(customer_id)
where payment_status in ('creating','pending');
create index store_orders_customer_created on public.store_orders(customer_id, created_at desc);
create index store_orders_processing on public.store_orders(payment_status, fulfillment_status, created_at desc);

create table public.store_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.store_orders(id) on delete restrict,
  reward_id uuid not null references public.loyalty_rewards(id) on delete restrict,
  name text not null,
  image_path text,
  quantity integer not null check (quantity between 1 and 99),
  price_mode text not null check (price_mode in ('coins','cash','mixed')),
  unit_cash numeric(12,2) not null check (unit_cash >= 0),
  unit_coins numeric(12,2) not null check (unit_coins >= 0),
  reserved_stock boolean not null,
  unique(order_id,reward_id,price_mode)
);
create index store_order_items_order on public.store_order_items(order_id);
alter table public.store_orders enable row level security;
alter table public.store_order_items enable row level security;
revoke all on public.store_orders, public.store_order_items from public, anon, authenticated;
grant select on public.store_orders, public.store_order_items to authenticated;
grant all on public.store_orders, public.store_order_items to service_role;
create policy store_orders_read on public.store_orders for select to authenticated
using (public.is_admin() or customer_id = public.current_customer_id());
create policy store_items_read on public.store_order_items for select to authenticated
using (exists (select 1 from public.store_orders o where o.id = order_id
  and (public.is_admin() or o.customer_id = public.current_customer_id())));

alter table public.loyalty_ledger add column store_order_id uuid references public.store_orders(id) on delete restrict;
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid = 'public.loyalty_ledger'::regclass
    and contype = 'c' and pg_get_constraintdef(oid) like '%redemption_id%'
  loop execute format('alter table public.loyalty_ledger drop constraint %I', c.conname); end loop;
end $$;
alter table public.loyalty_ledger add constraint loyalty_ledger_source_check check (
  (kind = 'earned' and points > 0 and lot_id is not null and redemption_id is null and store_order_id is null)
  or (kind = 'spent' and points < 0 and lot_id is null and num_nonnulls(redemption_id,store_order_id) = 1)
  or (kind = 'reversal' and lot_id is not null and redemption_id is null and store_order_id is null)
  or (kind = 'adjustment' and lot_id is null and redemption_id is null)
);
create unique index store_ledger_once_per_kind on public.loyalty_ledger(store_order_id,kind) where store_order_id is not null;

-- O catálogo público nunca expõe custos internos, nem por acesso direto à API.
revoke select on public.loyalty_rewards from public, anon, authenticated;
grant select(id,name,description,points_cost,stock,active,image_path,cash_price,mixed_cash_price,mixed_points_cost,created_at,updated_at)
on public.loyalty_rewards to authenticated;

create function public.checkout_store_cart(p_request_key uuid, p_items jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid := public.current_customer_id();
  v_order uuid; v_reward public.loyalty_rewards%rowtype; v_line record;
  v_cash numeric(12,2) := 0; v_coins numeric(12,2) := 0;
  v_unit_cash numeric(12,2); v_unit_coins numeric(12,2); v_balance numeric(12,2);
begin
  if v_customer is null or p_request_key is null then raise exception 'Cliente não autenticado.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'O carrinho deve conter de 1 a 50 produtos.';
  end if;
  -- Mesmo bloqueio das correções de saldo e dos resgates legados.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_customer::text,0));
  select id into v_order from public.store_orders where customer_id = v_customer and request_key = p_request_key;
  if found then return v_order; end if;
  if exists (select 1 from public.store_orders where customer_id = v_customer and payment_status in ('creating','pending')) then
    raise exception 'Você já tem um pedido aguardando Pix. Pague ou cancele antes de criar outro.';
  end if;
  perform 1 from public.loyalty_settings where id = true and active for share;
  if not found then raise exception 'A loja está indisponível no momento.'; end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as x(reward_id uuid, quantity integer, mode text)
    where reward_id is null or quantity is null or quantity not between 1 and 99
      or mode is null or mode not in ('coins','cash','mixed')) then raise exception 'Carrinho inválido.'; end if;
  if (select count(*) from (select distinct x.reward_id,x.mode from jsonb_to_recordset(p_items)
    as x(reward_id uuid, mode text)) d) <> jsonb_array_length(p_items) then raise exception 'Produto duplicado no carrinho.'; end if;
  -- Ordenação fixa evita deadlocks entre compras de produtos em ordens diferentes.
  perform r.id from public.loyalty_rewards r where r.id in (
    select x.reward_id from jsonb_to_recordset(p_items) as x(reward_id uuid)
  ) order by r.id for update;
  v_order := gen_random_uuid();
  insert into public.store_orders(id,customer_id,request_key,external_reference,cash_total,coins_total,payment_status)
  values (v_order,v_customer,p_request_key,'shop_' || v_order,0,1,'creating');
  for v_line in select * from jsonb_to_recordset(p_items) as x(reward_id uuid,quantity integer,mode text,expected_cash numeric,expected_coins numeric)
  loop
    select * into v_reward from public.loyalty_rewards where id = v_line.reward_id and active;
    if not found then raise exception 'Um produto não está mais disponível.'; end if;
    v_unit_cash := case v_line.mode when 'cash' then v_reward.cash_price when 'mixed' then v_reward.mixed_cash_price else 0 end;
    v_unit_coins := case v_line.mode when 'coins' then v_reward.points_cost when 'mixed' then v_reward.mixed_points_cost else 0 end;
    if v_unit_cash is null or v_unit_coins is null or v_unit_cash + v_unit_coins <= 0 then
      raise exception 'Modalidade de pagamento indisponível para %.',v_reward.name;
    end if;
    if v_line.expected_cash is distinct from v_unit_cash or v_line.expected_coins is distinct from v_unit_coins then
      raise exception 'O preço de % mudou. Atualize a loja antes de comprar.',v_reward.name;
    end if;
    if v_reward.stock is not null and v_reward.stock < v_line.quantity then raise exception 'Estoque insuficiente: %.',v_reward.name; end if;
    insert into public.store_order_items(order_id,reward_id,name,image_path,quantity,price_mode,unit_cash,unit_coins,reserved_stock)
    values (v_order,v_reward.id,v_reward.name,v_reward.image_path,v_line.quantity,v_line.mode,v_unit_cash,v_unit_coins,v_reward.stock is not null);
    if v_reward.stock is not null then update public.loyalty_rewards set stock = stock - v_line.quantity where id = v_reward.id; end if;
    v_cash := v_cash + v_unit_cash * v_line.quantity;
    v_coins := v_coins + v_unit_coins * v_line.quantity;
  end loop;
  select coalesce(sum(points),0) into v_balance from public.loyalty_ledger where customer_id = v_customer;
  if v_coins > 0 and v_coins > v_balance then raise exception 'Saldo de Caracoins insuficiente.'; end if;
  if v_cash > 0 and not exists (select 1 from public.customers where id = v_customer and nullif(trim(email),'') is not null) then
    raise exception 'Preencha seu e-mail em Meus dados antes de pagar por Pix.';
  end if;
  update public.store_orders set cash_total = v_cash, coins_total = v_coins,
    payment_status = case when v_cash = 0 then 'paid' else 'creating' end,
    paid_at = case when v_cash = 0 then now() end where id = v_order;
  if v_coins > 0 then
    insert into public.loyalty_ledger(customer_id,points,kind,store_order_id,note)
    values (v_customer,-v_coins,'spent',v_order,'Compra na loja · Caracoins reservadas');
  end if;
  return v_order;
end;
$$;
revoke all on function public.checkout_store_cart(uuid,jsonb) from public,anon;
grant execute on function public.checkout_store_cart(uuid,jsonb) to authenticated;

-- Apenas o servidor, após conferir o pagamento na API do Mercado Pago.
create function public.settle_store_payment(p_reference text,p_mp_order_id text,p_amount numeric,p_status text,p_paid_at timestamptz default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_order public.store_orders%rowtype;
begin
  if p_status not in ('paid','cancelled','expired','failed','refunded','partially_refunded') or p_mp_order_id is null then raise exception 'Status inválido.'; end if;
  select * into v_order from public.store_orders where external_reference = p_reference for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if p_amount is null or p_amount <> v_order.cash_total or v_order.cash_total <= 0
    or (v_order.mp_order_id is not null and v_order.mp_order_id <> p_mp_order_id) then raise exception 'Pagamento divergente.'; end if;
  if v_order.payment_status = p_status then return; end if;
  if p_status = 'partially_refunded' then
    if v_order.payment_status not in ('creating','pending','paid') then return; end if;
    update public.store_orders set payment_status = p_status,mp_order_id = p_mp_order_id,
      paid_at = coalesce(v_order.paid_at,p_paid_at,now()),updated_at = now() where id = v_order.id;
    return;
  end if;
  if p_status = 'paid' then
    if v_order.payment_status not in ('creating','pending') then
      if v_order.payment_status = 'partially_refunded' then return; end if;
      update public.store_orders set payment_status = 'payment_review',mp_order_id = p_mp_order_id,
        paid_at = coalesce(v_order.paid_at,p_paid_at,now()),updated_at = now() where id = v_order.id;
      return;
    end if;
    update public.store_orders set payment_status = 'paid',mp_order_id = p_mp_order_id,
      paid_at = coalesce(p_paid_at,now()),updated_at = now() where id = v_order.id;
    return;
  end if;
  if v_order.payment_status in ('cancelled','expired','failed','refunded') then return; end if;
  if v_order.payment_status in ('paid','partially_refunded','payment_review') and p_status <> 'refunded' then return; end if;
  if v_order.payment_status not in ('paid','partially_refunded','payment_review') and p_status = 'refunded' then p_status := 'failed'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_order.customer_id::text,0));
  if v_order.resources_released_at is null then
    if v_order.coins_total > 0 then
      insert into public.loyalty_ledger(customer_id,points,kind,store_order_id,note)
      values (v_order.customer_id,v_order.coins_total,'adjustment',v_order.id,'Caracoins devolvidas · pedido ' || v_order.code);
    end if;
    if v_order.fulfillment_status <> 'fulfilled' then
      perform r.id from public.loyalty_rewards r join public.store_order_items i on i.reward_id = r.id
      where i.order_id = v_order.id order by r.id for update of r;
      update public.loyalty_rewards r set stock = r.stock + x.quantity from (
        select reward_id,sum(quantity)::integer as quantity from public.store_order_items
        where order_id = v_order.id and reserved_stock group by reward_id
      ) x where r.id = x.reward_id and r.stock is not null;
    end if;
  end if;
  update public.store_orders set payment_status = p_status,mp_order_id = p_mp_order_id,
    resources_released_at = now(),updated_at = now() where id = v_order.id;
end;
$$;
revoke all on function public.settle_store_payment(text,text,numeric,text,timestamptz) from public,anon,authenticated;
grant execute on function public.settle_store_payment(text,text,numeric,text,timestamptz) to service_role;

create function public.handle_store_order(p_order_id uuid,p_status text,p_note text default null)
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
    insert into public.loyalty_ledger(customer_id,points,kind,store_order_id,note)
    values (v_order.customer_id,v_order.coins_total,'adjustment',v_order.id,'Pedido cancelado pela equipe · ' || v_order.code);
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
revoke all on function public.handle_store_order(uuid,text,text) from public,anon;
grant execute on function public.handle_store_order(uuid,text,text) to authenticated;

-- Desabilita o checkout de uma unidade da interface antiga: tudo passa pelo carrinho.
create or replace function public.request_loyalty_redemption(p_reward_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin raise exception 'Atualize a loja e adicione os produtos ao carrinho para comprar.'; end;
$$;

create or replace function public.get_loyalty_admin_stats()
returns table(total_earned numeric,points_in_circulation numeric,redemptions_pending bigint,inventory_cost numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado.'; end if;
  return query select
    coalesce((select sum(points) from public.loyalty_ledger where kind in ('earned','reversal')
      or (kind = 'adjustment' and note = 'Recalibração histórica de pontos (migração 0022)')),0)::numeric,
    coalesce((select sum(points) from public.loyalty_ledger),0)::numeric,
    ((select count(*) from public.loyalty_redemptions where status = 'pending') +
      (select count(*) from public.store_orders where (payment_status = 'paid' and fulfillment_status <> 'fulfilled')
        or payment_status in ('partially_refunded','payment_review')))::bigint,
    coalesce((select sum(internal_cost * coalesce(stock,0)) from public.loyalty_rewards where active and internal_cost is not null),0)::numeric;
end;
$$;
revoke all on function public.get_loyalty_admin_stats() from public,anon;
grant execute on function public.get_loyalty_admin_stats() to authenticated;

commit;
