-- Loyalty points and rewards store. The program starts disabled and without
-- an earn rate; no points are issued until staff configures and activates it.

create table if not exists public.loyalty_settings (
  id boolean primary key default true check (id),
  active boolean not null default false,
  points_per_real numeric(10,2) check (points_per_real is null or points_per_real > 0),
  points_expire_days integer check (points_expire_days is null or points_expire_days > 0),
  ranking_enabled boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.loyalty_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.loyalty_settings_history (
  id bigint generated always as identity primary key,
  active boolean not null,
  points_per_real numeric(10,2),
  points_expire_days integer,
  ranking_enabled boolean not null,
  note text,
  changed_by uuid references auth.users(id) on delete set null,
  effective_at timestamptz not null default now()
);

create table if not exists public.loyalty_rewards (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  description text,
  points_cost integer check (points_cost is null or points_cost > 0),
  internal_cost numeric(10,2) check (internal_cost is null or internal_cost >= 0),
  stock integer check (stock is null or stock >= 0),
  active boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.loyalty_redemptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  reward_id uuid references public.loyalty_rewards(id) on delete set null,
  reward_name text not null,
  points_cost integer not null check (points_cost > 0),
  status text not null default 'pending'
    check (status in ('pending','approved','fulfilled','rejected')),
  customer_note text,
  admin_note text,
  handled_by uuid references auth.users(id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.loyalty_ledger (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  points integer not null check (points <> 0),
  kind text not null check (kind in ('earned','spent','reversal','adjustment')),
  lot_id uuid references public.lots(id) on delete restrict,
  redemption_id uuid references public.loyalty_redemptions(id) on delete restrict,
  lot_value numeric(10,2),
  earn_rate numeric(10,2),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((kind = 'earned' and points > 0 and lot_id is not null and redemption_id is null)
      or (kind = 'spent' and points < 0 and redemption_id is not null and lot_id is null)
      or (kind = 'reversal' and lot_id is not null and redemption_id is null)
      or (kind = 'adjustment' and lot_id is null and redemption_id is null))
);

create unique index if not exists loyalty_ledger_redemption_spent_uq
  on public.loyalty_ledger(redemption_id) where kind = 'spent';
create index if not exists loyalty_ledger_customer_created_idx
  on public.loyalty_ledger(customer_id, created_at desc);
create index if not exists loyalty_redemptions_status_created_idx
  on public.loyalty_redemptions(status, created_at desc);

alter table public.lots add column if not exists loyalty_points_awarded integer not null default 0
  check (loyalty_points_awarded >= 0);
alter table public.customers add column if not exists loyalty_rank_visible boolean not null default false;

alter table public.loyalty_settings enable row level security;
alter table public.loyalty_settings_history enable row level security;
alter table public.loyalty_rewards enable row level security;
alter table public.loyalty_redemptions enable row level security;
alter table public.loyalty_ledger enable row level security;

drop policy if exists loyalty_settings_read on public.loyalty_settings;
create policy loyalty_settings_read on public.loyalty_settings for select to authenticated using (true);
drop policy if exists loyalty_settings_write on public.loyalty_settings;
revoke insert, update, delete on public.loyalty_settings from public, anon, authenticated;
drop policy if exists loyalty_settings_history_read on public.loyalty_settings_history;
create policy loyalty_settings_history_read on public.loyalty_settings_history for select to authenticated using (public.is_admin());
drop policy if exists loyalty_settings_history_write on public.loyalty_settings_history;
revoke insert, update, delete on public.loyalty_settings_history from public, anon, authenticated;

drop policy if exists loyalty_rewards_read on public.loyalty_rewards;
create policy loyalty_rewards_read on public.loyalty_rewards for select to authenticated
  using (active or public.is_admin());
drop policy if exists loyalty_rewards_write on public.loyalty_rewards;
create policy loyalty_rewards_write on public.loyalty_rewards for all to authenticated
  using (public.has_staff_write()) with check (public.has_staff_write());
revoke delete on public.loyalty_rewards from public, anon, authenticated;

create or replace function public.validate_loyalty_reward()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_active boolean; v_other_count integer;
begin
  select active into v_active from public.loyalty_settings where id = true;
  if new.active and (new.points_cost is null or new.internal_cost is null) then
    raise exception 'Para publicar a recompensa, defina o preço em pontos e o custo interno (use zero se não houver custo).';
  end if;
  if coalesce(v_active,false) then
    select count(*) into v_other_count from public.loyalty_rewards
      where active and points_cost is not null and internal_cost is not null
        and (tg_op = 'INSERT' or id <> new.id);
    if not new.active or new.points_cost is null or new.internal_cost is null then
      if v_other_count < 1 then raise exception 'Desative o programa antes de remover sua última recompensa válida.'; end if;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists loyalty_rewards_validate on public.loyalty_rewards;
create trigger loyalty_rewards_validate before insert or update of active, points_cost, internal_cost
  on public.loyalty_rewards for each row execute function public.validate_loyalty_reward();

drop policy if exists loyalty_redemptions_read on public.loyalty_redemptions;
create policy loyalty_redemptions_read on public.loyalty_redemptions for select to authenticated
  using (public.is_admin() or customer_id = public.current_customer_id());
drop policy if exists loyalty_redemptions_admin_write on public.loyalty_redemptions;
revoke insert, update, delete on public.loyalty_redemptions from public, anon, authenticated;

drop policy if exists loyalty_ledger_read on public.loyalty_ledger;
create policy loyalty_ledger_read on public.loyalty_ledger for select to authenticated
  using (public.is_admin() or customer_id = public.current_customer_id());

-- Internal ledger writes only (payment status trigger and guarded RPCs).
revoke insert, update, delete on public.loyalty_ledger from public, anon, authenticated;

create or replace function public.award_lot_loyalty_points()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_active boolean;
  v_rate numeric(10,2);
  v_points integer;
begin
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
    select s.active, s.points_per_real into v_active, v_rate
      from public.loyalty_settings s where s.id = true;
    if coalesce(v_active, false) and v_rate is not null then
      v_points := floor(new.arremate_value * v_rate)::integer;
      if v_points > 0 then
        insert into public.loyalty_ledger(customer_id, points, kind, lot_id, lot_value, earn_rate, note)
          values (new.customer_id, v_points, 'earned', new.id, new.arremate_value, v_rate, 'Pontos por lote pago')
          on conflict do nothing;
        if found then
          new.loyalty_points_awarded := v_points;
        end if;
      end if;
    end if;
  elsif tg_op = 'UPDATE' and old.status = 'paid' and new.status <> 'paid'
        and old.loyalty_points_awarded > 0 then
    insert into public.loyalty_ledger(customer_id, points, kind, lot_id, note)
      values (old.customer_id, -old.loyalty_points_awarded, 'reversal', old.id,
        'Estorno de pontos: lote deixou de estar pago')
      on conflict do nothing;
    new.loyalty_points_awarded := 0;
  end if;
  return new;
end;
$$;

drop trigger if exists lots_award_loyalty_points on public.lots;
create trigger lots_award_loyalty_points before insert or update of status on public.lots
  for each row execute function public.award_lot_loyalty_points();

create or replace function public.request_loyalty_redemption(p_reward_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid;
  v_reward public.loyalty_rewards%rowtype;
  v_balance bigint;
  v_redemption uuid;
begin
  v_customer := public.current_customer_id();
  if v_customer is null then raise exception 'Cliente não autenticado.'; end if;
  if not exists (select 1 from public.loyalty_settings where id = true and active) then
    raise exception 'A loja de pontos está indisponível.';
  end if;
  select * into v_reward from public.loyalty_rewards
    where id = p_reward_id and active for update;
  if not found or v_reward.points_cost is null then raise exception 'Recompensa indisponível.'; end if;
  if v_reward.stock is not null and v_reward.stock < 1 then raise exception 'Recompensa sem estoque.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_customer::text, 0));
  select coalesce(sum(points),0) into v_balance from public.loyalty_ledger where customer_id = v_customer;
  if v_balance < v_reward.points_cost then raise exception 'Você ainda não tem pontos suficientes.'; end if;
  insert into public.loyalty_redemptions(customer_id, reward_id, reward_name, points_cost)
    values (v_customer, v_reward.id, v_reward.name, v_reward.points_cost) returning id into v_redemption;
  insert into public.loyalty_ledger(customer_id, points, kind, redemption_id, note)
    values (v_customer, -v_reward.points_cost, 'spent', v_redemption, 'Resgate solicitado');
  if v_reward.stock is not null then
    update public.loyalty_rewards set stock = stock - 1, updated_at = now() where id = v_reward.id;
  end if;
  return v_redemption;
end;
$$;

create or replace function public.adjust_loyalty_points(p_customer_id uuid, p_points integer, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_balance bigint;
begin
  if not public.has_staff_write() then raise exception 'Acesso negado.'; end if;
  if p_points = 0 or abs(p_points::bigint) > 1000000 or char_length(trim(coalesce(p_note,''))) < 4 then
    raise exception 'Informe uma quantidade válida e o motivo do ajuste.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_customer_id::text, 0));
  select coalesce(sum(points),0) into v_balance from public.loyalty_ledger where customer_id = p_customer_id;
  if v_balance + p_points < 0 then raise exception 'O débito não pode superar o saldo atual do cliente.'; end if;
  insert into public.loyalty_ledger(customer_id, points, kind, note, created_by)
    values (p_customer_id, p_points, 'adjustment', left(trim(p_note),500), auth.uid());
end;
$$;

create or replace function public.save_loyalty_settings(
  p_active boolean, p_points_per_real numeric, p_ranking_enabled boolean, p_note text default null
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_staff_write() then raise exception 'Acesso negado.'; end if;
  if p_points_per_real is not null and (p_points_per_real <= 0 or p_points_per_real > 10000) then
    raise exception 'Regra de ganho inválida.';
  end if;
  if p_active and (p_points_per_real is null or not exists (
    select 1 from public.loyalty_rewards where active and points_cost is not null and internal_cost is not null
  )) then raise exception 'Defina a regra de ganho e cadastre uma recompensa ativa com preço em pontos e custo interno.'; end if;
  insert into public.loyalty_settings(id, active, points_per_real, points_expire_days, ranking_enabled, updated_by, updated_at)
    values (true, p_active, p_points_per_real, null, p_ranking_enabled, auth.uid(), now())
    on conflict (id) do update set active = excluded.active, points_per_real = excluded.points_per_real,
      points_expire_days = null, ranking_enabled = excluded.ranking_enabled,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into public.loyalty_settings_history(active, points_per_real, points_expire_days, ranking_enabled, note, changed_by)
    values (p_active, p_points_per_real, null, p_ranking_enabled, nullif(left(p_note,500),''), auth.uid());
end;
$$;

create or replace function public.handle_loyalty_redemption(p_redemption_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row public.loyalty_redemptions%rowtype;
begin
  if not public.has_staff_write() then raise exception 'Acesso negado.'; end if;
  if p_status not in ('approved','fulfilled','rejected') then raise exception 'Status inválido.'; end if;
  select * into v_row from public.loyalty_redemptions where id = p_redemption_id for update;
  if not found then raise exception 'Resgate não encontrado.'; end if;
  if v_row.status in ('rejected','fulfilled') then raise exception 'Este resgate já foi finalizado.'; end if;
  if v_row.status = 'approved' and p_status = 'approved' then raise exception 'Resgate já aprovado.'; end if;
  if p_status = 'rejected' and v_row.status <> 'rejected' then
    insert into public.loyalty_ledger(customer_id, points, kind, redemption_id, note)
      values (v_row.customer_id, v_row.points_cost, 'adjustment', null, 'Estorno do resgate ' || v_row.reward_name);
    if v_row.reward_id is not null then
      update public.loyalty_rewards set stock = stock + 1, updated_at = now()
        where id = v_row.reward_id and stock is not null;
    end if;
  end if;
  update public.loyalty_redemptions set status = p_status, admin_note = left(p_note,500),
    handled_by = auth.uid(), handled_at = now() where id = p_redemption_id;
end;
$$;

create or replace function public.get_loyalty_ranking()
returns table(customer_name text, points bigint)
language sql stable security definer set search_path = '' as $$
  select case
      when nullif(split_part(trim(c.name), ' ', 1), '') is null then 'Colecionador'
      when position(' ' in trim(c.name)) > 0 then
        split_part(trim(c.name), ' ', 1) || ' ' || left(split_part(trim(c.name), ' ', 2), 1) || '.'
      else split_part(trim(c.name), ' ', 1)
    end,
    sum(case when l.kind in ('earned','reversal') then l.points else 0 end)::bigint as points
  from public.customers c
  join public.loyalty_ledger l on l.customer_id = c.id
  where c.loyalty_rank_visible
    and exists (select 1 from public.loyalty_settings s where s.id = true and s.active and s.ranking_enabled)
  group by c.id, c.name
  having sum(case when l.kind in ('earned','reversal') then l.points else 0 end) > 0
  order by sum(case when l.kind in ('earned','reversal') then l.points else 0 end) desc, min(l.created_at) asc
  limit 10;
$$;

create or replace function public.get_loyalty_admin_stats()
returns table(total_earned bigint, points_in_circulation bigint, redemptions_pending bigint, inventory_cost numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado.'; end if;
  return query
    select coalesce((select sum(points) from public.loyalty_ledger where kind = 'earned'),0)::bigint,
      coalesce((select sum(points) from public.loyalty_ledger),0)::bigint,
      (select count(*) from public.loyalty_redemptions where status = 'pending')::bigint,
      coalesce((select sum(internal_cost * coalesce(stock,0)) from public.loyalty_rewards where active and internal_cost is not null),0)::numeric;
end;
$$;

create or replace function public.get_customer_loyalty_balance(p_customer_id uuid default null)
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare v_customer uuid;
begin
  v_customer := coalesce(p_customer_id, public.current_customer_id());
  if v_customer is null or (not public.is_admin() and v_customer <> public.current_customer_id()) then
    raise exception 'Acesso negado.';
  end if;
  return coalesce((select sum(points) from public.loyalty_ledger where customer_id = v_customer),0)::bigint;
end;
$$;

revoke all on function public.request_loyalty_redemption(uuid) from public, anon;
grant execute on function public.request_loyalty_redemption(uuid) to authenticated;
revoke all on function public.adjust_loyalty_points(uuid,integer,text) from public, anon;
grant execute on function public.adjust_loyalty_points(uuid,integer,text) to authenticated;
revoke all on function public.save_loyalty_settings(boolean,numeric,boolean,text) from public, anon;
grant execute on function public.save_loyalty_settings(boolean,numeric,boolean,text) to authenticated;
revoke all on function public.get_loyalty_ranking() from public, anon;
grant execute on function public.get_loyalty_ranking() to authenticated;
revoke all on function public.get_loyalty_admin_stats() from public, anon;
grant execute on function public.get_loyalty_admin_stats() to authenticated;
revoke all on function public.get_customer_loyalty_balance(uuid) from public, anon;
grant execute on function public.get_customer_loyalty_balance(uuid) to authenticated;
revoke all on function public.handle_loyalty_redemption(uuid,text,text) from public, anon, authenticated;
grant execute on function public.handle_loyalty_redemption(uuid,text,text) to authenticated;

comment on table public.loyalty_ledger is 'Append-only points ledger, separate from money and freight.';
comment on column public.lots.loyalty_points_awarded is 'Points issued by the payment transition; reversed when the lot leaves paid.';
