-- Loyalty tiers are based on cumulative paid lots (shipping is excluded).
-- Fractional points are required for 0.5 / 1.5 / 2.5 points per real.
alter table public.loyalty_ledger
  alter column points type numeric(12,2) using points::numeric(12,2);

alter table public.lots
  alter column loyalty_points_awarded type numeric(12,2)
    using loyalty_points_awarded::numeric(12,2);

create index if not exists lots_paid_customer_rank_idx
  on public.lots(customer_id)
  where status in ('paid', 'shipped', 'delivered');

create or replace function public.award_lot_loyalty_points()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_active boolean;
  v_spent numeric(12,2);
  v_rate numeric(10,2);
  v_points numeric(12,2);
begin
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
    select coalesce(s.active, false) into v_active
      from public.loyalty_settings s where s.id = true;
    if v_active then
      -- Serialize simultaneous payments by the same customer. Lots in one
      -- Pix use the same pre-payment tier, independent of update row order.
      perform 1 from public.customers c where c.id = new.customer_id for update;
      select coalesce(sum(l.arremate_value), 0) into v_spent
        from public.lots l
        where l.customer_id = new.customer_id
          and l.status in ('paid', 'shipped', 'delivered')
          and (new.charge_id is null or l.charge_id is distinct from new.charge_id);

      v_rate := case
        when v_spent < 1000 then 0.5
        when v_spent < 5000 then 1.0
        when v_spent < 15000 then 1.5
        when v_spent < 25000 then 2.0
        when v_spent < 50000 then 2.5
        else 3.0
      end;
      v_points := round(new.arremate_value * v_rate, 2);
      if v_points > 0 then
        insert into public.loyalty_ledger(customer_id, points, kind, lot_id, lot_value, earn_rate, note)
          values (new.customer_id, v_points, 'earned', new.id, new.arremate_value, v_rate,
            'Pontos por lote pago · faixa de gasto acumulado')
          on conflict do nothing;
        if found then new.loyalty_points_awarded := v_points; end if;
      end if;
    end if;
  elsif tg_op = 'UPDATE'
        and old.status in ('paid', 'shipped', 'delivered')
        and new.status = 'cancelled'
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

create or replace function public.save_loyalty_settings(
  p_active boolean, p_points_per_real numeric, p_ranking_enabled boolean, p_note text default null
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_staff_write() then raise exception 'Acesso negado.'; end if;
  if p_points_per_real is not null then
    raise exception 'A taxa agora é definida automaticamente pelo elo do cliente.';
  end if;
  if p_active and not exists (
    select 1 from public.loyalty_rewards where active and points_cost is not null and internal_cost is not null
  ) then
    raise exception 'Cadastre uma recompensa ativa com preço em pontos e custo interno.';
  end if;
  insert into public.loyalty_settings(id, active, points_per_real, points_expire_days, ranking_enabled, updated_by, updated_at)
    values (true, p_active, null, null, p_ranking_enabled, auth.uid(), now())
    on conflict (id) do update set active = excluded.active, points_per_real = null,
      points_expire_days = null, ranking_enabled = excluded.ranking_enabled,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into public.loyalty_settings_history(active, points_per_real, points_expire_days, ranking_enabled, note, changed_by)
    values (p_active, null, null, p_ranking_enabled, nullif(left(p_note,500),''), auth.uid());
end;
$$;

drop function public.get_loyalty_admin_stats();
create function public.get_loyalty_admin_stats()
returns table(total_earned numeric, points_in_circulation numeric, redemptions_pending bigint, inventory_cost numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado.'; end if;
  return query
    select coalesce((select sum(points) from public.loyalty_ledger where kind = 'earned'),0)::numeric,
      coalesce((select sum(points) from public.loyalty_ledger),0)::numeric,
      (select count(*) from public.loyalty_redemptions where status = 'pending')::bigint,
      coalesce((select sum(internal_cost * coalesce(stock,0)) from public.loyalty_rewards where active and internal_cost is not null),0)::numeric;
end;
$$;
revoke all on function public.get_loyalty_admin_stats() from public, anon;
grant execute on function public.get_loyalty_admin_stats() to authenticated;

drop function public.get_customer_loyalty_balance(uuid);
create function public.get_customer_loyalty_balance(p_customer_id uuid default null)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare v_customer uuid;
begin
  v_customer := coalesce(p_customer_id, public.current_customer_id());
  if v_customer is null or (not public.is_admin() and v_customer <> public.current_customer_id()) then
    raise exception 'Acesso negado.';
  end if;
  return coalesce((select sum(points) from public.loyalty_ledger where customer_id = v_customer),0)::numeric;
end;
$$;
revoke all on function public.get_customer_loyalty_balance(uuid) from public, anon;
grant execute on function public.get_customer_loyalty_balance(uuid) to authenticated;

-- Keep redemption checks exact after the ledger starts accepting fractions.
create or replace function public.request_loyalty_redemption(p_reward_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid;
  v_reward public.loyalty_rewards%rowtype;
  v_balance numeric(12,2);
  v_redemption uuid;
begin
  v_customer := public.current_customer_id();
  if v_customer is null then raise exception 'Cliente não autenticado.'; end if;
  if not exists (select 1 from public.loyalty_settings where id = true and active) then
    raise exception 'A loja de pontos está indisponível.';
  end if;
  select * into v_reward from public.loyalty_rewards where id = p_reward_id and active for update;
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
declare v_balance numeric(12,2);
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

drop function public.get_loyalty_ranking();

create or replace function public.get_loyalty_tier_leaders()
returns table(tier_key text, tier_name text, customer_name text, points numeric)
language sql stable security definer set search_path = '' as $$
  with tiers(tier_key, tier_name, min_spend, max_spend, tier_order) as (
    values ('lilas','Lilás',0::numeric,1000::numeric,1),
           ('bronze','Bronze',1000::numeric,5000::numeric,2),
           ('prata','Prata',5000::numeric,15000::numeric,3),
           ('ouro','Ouro',15000::numeric,25000::numeric,4),
           ('crumple','Crumple',25000::numeric,50000::numeric,5),
           ('prizm','Prizm',50000::numeric,null::numeric,6)
  ), spend as (
    select l.customer_id, sum(l.arremate_value)::numeric as total_spent
    from public.lots l
    where l.status in ('paid','shipped','delivered')
    group by l.customer_id
  ), eligible as (
    select s.customer_id, s.total_spent,
      case
        when s.total_spent < 1000 then 'lilas'
        when s.total_spent < 5000 then 'bronze'
        when s.total_spent < 15000 then 'prata'
        when s.total_spent < 25000 then 'ouro'
        when s.total_spent < 50000 then 'crumple'
        else 'prizm'
      end as tier_key,
      sum(ll.points)::numeric as points,
      c.name
    from spend s
    join public.customers c on c.id = s.customer_id and c.loyalty_rank_visible
    join public.loyalty_ledger ll on ll.customer_id = s.customer_id
    group by s.customer_id, s.total_spent, c.name
  ), leaders as (
    select distinct on (e.tier_key) e.tier_key, e.name, e.points
    from eligible e
    order by e.tier_key, e.total_spent desc, e.points desc, e.customer_id
  )
  select t.tier_key, t.tier_name,
    case
      when nullif(split_part(trim(l.name), ' ', 1), '') is null then null
      when position(' ' in trim(l.name)) > 0 then
        split_part(trim(l.name), ' ', 1) || ' ' || left(split_part(trim(l.name), ' ', 2), 1) || '.'
      else split_part(trim(l.name), ' ', 1)
    end as customer_name,
    l.points
  from tiers t
  left join leaders l on l.tier_key = t.tier_key
  where exists (select 1 from public.loyalty_settings s where s.id = true and s.active and s.ranking_enabled)
  order by t.tier_order;
$$;
revoke all on function public.get_loyalty_tier_leaders() from public, anon;
grant execute on function public.get_loyalty_tier_leaders() to authenticated;
