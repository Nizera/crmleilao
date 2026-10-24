-- Elo progression is measured in earned points, while each tier sets the
-- earn rate for future lot payments. Redeeming points does not lower a tier.
-- Retire the legacy global rate so it cannot be mistaken for the active rule.
update public.loyalty_settings
set points_per_real = null
where id = true and points_per_real is not null;

-- Recalculate legacy credits using the new points-based tiers. Keep the old
-- ledger entries intact and record one auditable adjustment per customer.
create temporary table _loyalty_tier_recalculation (
  customer_id uuid not null,
  lot_id uuid primary key,
  expected_points numeric(12,2) not null
);

do $$
declare
  v_customer record;
  v_batch record;
  v_lot record;
  v_rank_points numeric(12,2);
  v_rate numeric(10,2);
  v_lot_points numeric(12,2);
  v_batch_points numeric(12,2);
  v_correct_total numeric(12,2);
  v_current_earned numeric(12,2);
  v_current_balance numeric(12,2);
  v_delta numeric(12,2);
begin
  for v_customer in
    select distinct customer_id from public.loyalty_ledger where kind = 'earned'
  loop
    v_rank_points := 0;
    for v_batch in
      select coalesce(l.charge_id::text, 'lot:' || l.id::text) as batch_key,
             min(coalesce(l.paid_at, ll.created_at)) as paid_at
      from public.loyalty_ledger ll
      join public.lots l on l.id = ll.lot_id
      where ll.customer_id = v_customer.customer_id
        and ll.kind = 'earned'
        and l.status in ('paid', 'shipped', 'delivered')
      group by coalesce(l.charge_id::text, 'lot:' || l.id::text)
      order by min(coalesce(l.paid_at, ll.created_at)), batch_key
    loop
      v_rate := case
        when v_rank_points < 1000 then 0.5
        when v_rank_points < 5000 then 1.0
        when v_rank_points < 15000 then 1.5
        when v_rank_points < 25000 then 2.0
        when v_rank_points < 50000 then 2.5
        else 3.0
      end;
      v_batch_points := 0;
      for v_lot in
        select l.id, coalesce(ll.lot_value, l.arremate_value) as lot_value
        from public.loyalty_ledger ll
        join public.lots l on l.id = ll.lot_id
        where ll.customer_id = v_customer.customer_id
          and ll.kind = 'earned'
          and l.status in ('paid', 'shipped', 'delivered')
          and coalesce(l.charge_id::text, 'lot:' || l.id::text) = v_batch.batch_key
        order by l.paid_at, l.id
      loop
        v_lot_points := round(v_lot.lot_value * v_rate, 2);
        insert into _loyalty_tier_recalculation(customer_id, lot_id, expected_points)
          values (v_customer.customer_id, v_lot.id, v_lot_points)
          on conflict (lot_id) do update set expected_points = excluded.expected_points;
        v_batch_points := v_batch_points + v_lot_points;
      end loop;
      v_rank_points := v_rank_points + v_batch_points;
    end loop;

    select coalesce(sum(expected_points), 0) into v_correct_total
    from _loyalty_tier_recalculation where customer_id = v_customer.customer_id;
    select coalesce(sum(points), 0) into v_current_earned
    from public.loyalty_ledger
    where customer_id = v_customer.customer_id and kind in ('earned', 'reversal');
    v_delta := v_correct_total - v_current_earned;
    if v_delta <> 0 then
      insert into public.loyalty_ledger(customer_id, points, kind, note)
      values (v_customer.customer_id, v_delta, 'adjustment',
        'Recalibração histórica de pontos (migração 0022)');

      -- Never turn an already-spent balance negative. This separate balance
      -- protection does not count toward rank points.
      select coalesce(sum(points), 0) into v_current_balance
      from public.loyalty_ledger where customer_id = v_customer.customer_id;
      if v_current_balance < 0 then
        insert into public.loyalty_ledger(customer_id, points, kind, note)
        values (v_customer.customer_id, -v_current_balance, 'adjustment',
          'Proteção de saldo por resgates anteriores à recalibração');
      end if;
    end if;
  end loop;

  update public.lots l
  set loyalty_points_awarded = coalesce((
    select r.expected_points from _loyalty_tier_recalculation r where r.lot_id = l.id
  ), 0)
  where l.status in ('paid', 'shipped', 'delivered')
    and exists (select 1 from public.loyalty_ledger ll where ll.lot_id = l.id and ll.kind = 'earned');
end;
$$;

create or replace function public.award_lot_loyalty_points()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_active boolean;
  v_earned_before numeric(12,2);
  v_rate numeric(10,2);
  v_points numeric(12,2);
begin
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
    select coalesce(s.active, false) into v_active
      from public.loyalty_settings s where s.id = true;
    if v_active then
      -- Serialize concurrent payments. A single Pix batch uses one tier/rate
      -- even as its lots are updated one by one.
      perform 1 from public.customers c where c.id = new.customer_id for update;
      select coalesce(sum(ll.points), 0) into v_earned_before
        from public.loyalty_ledger ll
        where ll.customer_id = new.customer_id
          and (ll.kind in ('earned', 'reversal')
            or (ll.kind = 'adjustment' and ll.note = 'Recalibração histórica de pontos (migração 0022)'))
          and (new.charge_id is null or not exists (
            select 1 from public.lots batch_lot
            where batch_lot.id = ll.lot_id
              and batch_lot.charge_id = new.charge_id
          ));

      v_rate := case
        when v_earned_before < 1000 then 0.5
        when v_earned_before < 5000 then 1.0
        when v_earned_before < 15000 then 1.5
        when v_earned_before < 25000 then 2.0
        when v_earned_before < 50000 then 2.5
        else 3.0
      end;
      v_points := round(new.arremate_value * v_rate, 2);
      if v_points > 0 then
        insert into public.loyalty_ledger(customer_id, points, kind, lot_id, lot_value, earn_rate, note)
          values (new.customer_id, v_points, 'earned', new.id, new.arremate_value, v_rate,
            'Pontos por lote pago · elo medido em pontos ganhos')
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
        'Estorno de pontos: lote cancelado')
      on conflict do nothing;
    new.loyalty_points_awarded := 0;
  end if;
  return new;
end;
$$;

create or replace function public.get_loyalty_tier_leaders()
returns table(tier_key text, tier_name text, customer_name text, points numeric)
language sql stable security definer set search_path = '' as $$
  with tiers(tier_key, tier_name, min_points, tier_order) as (
    values ('lilas','Lilás',0::numeric,1),
           ('bronze','Bronze',1000::numeric,2),
           ('prata','Prata',5000::numeric,3),
           ('ouro','Ouro',15000::numeric,4),
           ('crumple','Crumple',25000::numeric,5),
           ('prizm','Prizm',50000::numeric,6)
  ), earned as (
    select l.customer_id, sum(l.points)::numeric as points
    from public.loyalty_ledger l
    where l.kind in ('earned', 'reversal')
       or (l.kind = 'adjustment' and l.note = 'Recalibração histórica de pontos (migração 0022)')
    group by l.customer_id
    having sum(l.points) > 0
  ), eligible as (
    select e.customer_id, e.points, c.name,
      case
        when e.points < 1000 then 'lilas'
        when e.points < 5000 then 'bronze'
        when e.points < 15000 then 'prata'
        when e.points < 25000 then 'ouro'
        when e.points < 50000 then 'crumple'
        else 'prizm'
      end as tier_key
    from earned e
    join public.customers c on c.id = e.customer_id and c.loyalty_rank_visible
  ), leaders as (
    select distinct on (e.tier_key) e.tier_key, e.name, e.points
    from eligible e
    order by e.tier_key, e.points desc, e.customer_id
  )
  select t.tier_key, t.tier_name,
    case
      when nullif(split_part(trim(l.name), ' ', 1), '') is null then 'Colecionador'
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

create or replace function public.get_customer_loyalty_earned_points(p_customer_id uuid default null)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare v_customer uuid;
begin
  v_customer := coalesce(p_customer_id, public.current_customer_id());
  if v_customer is null or (not public.is_admin() and v_customer <> public.current_customer_id()) then
    raise exception 'Acesso negado.';
  end if;
  return coalesce((
    select sum(points) from public.loyalty_ledger
    where customer_id = v_customer and (kind in ('earned', 'reversal')
      or (kind = 'adjustment' and note = 'Recalibração histórica de pontos (migração 0022)'))
  ), 0)::numeric;
end;
$$;

create or replace function public.get_loyalty_admin_stats()
returns table(total_earned numeric, points_in_circulation numeric, redemptions_pending bigint, inventory_cost numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado.'; end if;
  return query
    select coalesce((select sum(points) from public.loyalty_ledger
      where kind in ('earned', 'reversal')
         or (kind = 'adjustment' and note = 'Recalibração histórica de pontos (migração 0022)')), 0)::numeric,
      coalesce((select sum(points) from public.loyalty_ledger), 0)::numeric,
      (select count(*) from public.loyalty_redemptions where status = 'pending')::bigint,
      coalesce((select sum(internal_cost * coalesce(stock, 0)) from public.loyalty_rewards
        where active and internal_cost is not null), 0)::numeric;
end;
$$;
revoke all on function public.get_loyalty_admin_stats() from public, anon;
grant execute on function public.get_loyalty_admin_stats() to authenticated;

drop function public.adjust_loyalty_points(uuid, integer, text);
create function public.adjust_loyalty_points(p_customer_id uuid, p_points numeric, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_balance numeric(12,2);
begin
  if not public.has_staff_write() then raise exception 'Acesso negado.'; end if;
  if p_points is null or p_points = 0 or abs(p_points) > 1000000
     or p_points <> round(p_points, 2)
     or char_length(trim(coalesce(p_note, ''))) < 4 then
    raise exception 'Informe pontos válidos (até 2 casas decimais) e o motivo do ajuste.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_customer_id::text, 0));
  select coalesce(sum(points), 0) into v_balance
  from public.loyalty_ledger where customer_id = p_customer_id;
  if v_balance + p_points < 0 then raise exception 'O débito não pode superar o saldo atual do cliente.'; end if;
  insert into public.loyalty_ledger(customer_id, points, kind, note, created_by)
  values (p_customer_id, p_points, 'adjustment', left(trim(p_note), 500), auth.uid());
end;
$$;
revoke all on function public.adjust_loyalty_points(uuid, numeric, text) from public, anon;
grant execute on function public.adjust_loyalty_points(uuid, numeric, text) to authenticated;

revoke all on function public.get_customer_loyalty_earned_points(uuid) from public, anon;
grant execute on function public.get_customer_loyalty_earned_points(uuid) to authenticated;
