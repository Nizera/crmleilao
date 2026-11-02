-- Histórico anterior ao app altera somente a pontuação de ranking.
-- Caracoins continuam exclusivamente no loyalty_ledger.
begin;

create table if not exists public.loyalty_rank_history (
  customer_id uuid not null references public.customers(id) on delete restrict,
  source_key text not null check(length(trim(source_key)) > 0),
  paid_amount numeric(12,2) not null check(paid_amount >= 0),
  rank_points numeric(12,2) not null check(rank_points >= 0),
  note text not null,
  recorded_at timestamptz not null default now(),
  primary key(customer_id,source_key)
);
alter table public.loyalty_rank_history enable row level security;
revoke all on public.loyalty_rank_history from public,anon,authenticated;
grant all on public.loyalty_rank_history to service_role;

create or replace function public.get_customer_loyalty_earned_points(p_customer_id uuid default null)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare v_customer uuid;
begin
  v_customer := coalesce(p_customer_id, public.current_customer_id());
  if v_customer is null or (not coalesce(public.is_admin(),false)
    and v_customer is distinct from public.current_customer_id()) then
    raise exception 'Acesso negado.';
  end if;
  return (
    coalesce((select sum(h.rank_points) from public.loyalty_rank_history h
      where h.customer_id=v_customer),0)
    + coalesce((select sum(l.points) from public.loyalty_ledger l
      where l.customer_id=v_customer and (l.kind in ('earned','reversal')
        or (l.kind='adjustment' and l.note='Recalibração histórica de pontos (migração 0022)'))),0)
  )::numeric;
end;
$$;
revoke all on function public.get_customer_loyalty_earned_points(uuid) from public,anon;
grant execute on function public.get_customer_loyalty_earned_points(uuid) to authenticated;

create or replace function public.get_loyalty_tier_leaders()
returns table(tier_key text,tier_name text,customer_name text,points numeric)
language sql stable security definer set search_path = '' as $$
  with tiers(tier_key,tier_name,tier_order) as (
    values ('lilas','Lilás',1),('bronze','Bronze',2),('prata','Prata',3),
      ('ouro','Ouro',4),('crumple','Crumple',5),('prizm','Prizm',6)
  ), contributions as (
    select h.customer_id,h.rank_points as points from public.loyalty_rank_history h
    union all
    select l.customer_id,l.points from public.loyalty_ledger l
    where l.kind in ('earned','reversal')
      or (l.kind='adjustment' and l.note='Recalibração histórica de pontos (migração 0022)')
  ), earned as (
    select customer_id,sum(points)::numeric as points from contributions
    group by customer_id having sum(points)>0
  ), eligible as (
    select e.customer_id,e.points,c.name,
      case when e.points<1000 then 'lilas' when e.points<5000 then 'bronze'
        when e.points<15000 then 'prata' when e.points<25000 then 'ouro'
        when e.points<50000 then 'crumple' else 'prizm' end as tier_key
    from earned e join public.customers c on c.id=e.customer_id and c.loyalty_rank_visible
  ), leaders as (
    select distinct on(e.tier_key) e.tier_key,e.name,e.points
    from eligible e order by e.tier_key,e.points desc,e.customer_id
  )
  select t.tier_key,t.tier_name,
    case when nullif(split_part(trim(l.name),' ',1),'') is null then 'Colecionador'
      when position(' ' in trim(l.name))>0 then
        split_part(trim(l.name),' ',1)||' '||left(split_part(trim(l.name),' ',2),1)||'.'
      else split_part(trim(l.name),' ',1) end as customer_name,
    l.points
  from tiers t left join leaders l on l.tier_key=t.tier_key
  where exists(select 1 from public.loyalty_settings s where s.id=true and s.active and s.ranking_enabled)
  order by t.tier_order;
$$;
revoke all on function public.get_loyalty_tier_leaders() from public,anon;
grant execute on function public.get_loyalty_tier_leaders() to authenticated;

create or replace function public.award_lot_loyalty_points()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_active boolean; v_earned_before numeric(12,2);
  v_rate numeric(10,2); v_points numeric(12,2);
begin
  if new.status='paid' and (tg_op='INSERT' or old.status is distinct from 'paid') then
    select coalesce(s.active,false) into v_active from public.loyalty_settings s where s.id=true;
    if v_active then
      perform 1 from public.customers c where c.id=new.customer_id for update;
      select coalesce(sum(ll.points),0) into v_earned_before
      from public.loyalty_ledger ll
      where ll.customer_id=new.customer_id
        and (ll.kind in ('earned','reversal')
          or (ll.kind='adjustment' and ll.note='Recalibração histórica de pontos (migração 0022)'))
        and (new.charge_id is null or not exists(
          select 1 from public.lots batch_lot where batch_lot.id=ll.lot_id
            and batch_lot.charge_id=new.charge_id));
      -- O histórico define o elo/taxa, mas não gera Caracoins retroativos.
      v_earned_before:=v_earned_before+coalesce((
        select sum(h.rank_points) from public.loyalty_rank_history h
        where h.customer_id=new.customer_id),0);
      v_rate:=case when v_earned_before<1000 then 0.5 when v_earned_before<5000 then 1
        when v_earned_before<15000 then 1.5 when v_earned_before<25000 then 2
        when v_earned_before<50000 then 2.5 else 3 end;
      v_points:=round(new.arremate_value*v_rate,2);
      if v_points>0 then
        insert into public.loyalty_ledger(customer_id,points,kind,lot_id,lot_value,earn_rate,note)
        values(new.customer_id,v_points,'earned',new.id,new.arremate_value,v_rate,
          'Caracoins por lote pago no app · taxa do elo atual') on conflict do nothing;
        if found then new.loyalty_points_awarded:=v_points; end if;
      end if;
    end if;
  elsif tg_op='UPDATE' and old.status in ('paid','shipped','delivered')
    and new.status='cancelled' and old.loyalty_points_awarded>0 then
    insert into public.loyalty_ledger(customer_id,points,kind,lot_id,note)
    values(old.customer_id,-old.loyalty_points_awarded,'reversal',old.id,
      'Estorno de pontos: lote cancelado') on conflict do nothing;
    new.loyalty_points_awarded:=0;
  end if;
  return new;
end;
$$;
commit;
