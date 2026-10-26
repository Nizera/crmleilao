-- Dashboard da loja e custo histórico de novas compras. Não recalcula custos antigos.
begin;
alter table public.store_order_items add column unit_internal_cost numeric(12,2) check(unit_internal_cost >= 0);
-- O custo não pode ficar acessível ao comprador, mesmo com select(*).
revoke select on public.store_order_items from authenticated;
grant select(id,order_id,reward_id,name,image_path,quantity,price_mode,unit_cash,unit_coins,reserved_stock)
  on public.store_order_items to authenticated;
create function public.snapshot_store_item_cost()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select r.internal_cost into new.unit_internal_cost from public.loyalty_rewards r where r.id=new.reward_id;
  return new;
end;
$$;
revoke all on function public.snapshot_store_item_cost() from public,anon,authenticated;
create trigger store_item_cost_snapshot before insert on public.store_order_items
for each row execute function public.snapshot_store_item_cost();
create index if not exists store_orders_paid_at_idx on public.store_orders(paid_at) where payment_status='paid';

create function public.get_store_dashboard(p_from date default null,p_to date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not public.is_admin() then raise exception 'Acesso negado.'; end if;
  p_to := coalesce(p_to,(now() at time zone 'America/Sao_Paulo')::date);
  p_from := coalesce(p_from,p_to-29);
  if p_from > p_to or p_to-p_from > 365 then raise exception 'Selecione um período de até 366 dias.'; end if;
  with paid as materialized (
    select o.id,'store'::text as source,o.cash_total,o.coins_total,
      (coalesce(o.paid_at,o.created_at) at time zone 'America/Sao_Paulo')::date as day
    from public.store_orders o where o.payment_status='paid'
      and coalesce(o.paid_at,o.created_at) >= (p_from::timestamp at time zone 'America/Sao_Paulo')
      and coalesce(o.paid_at,o.created_at) < ((p_to+1)::timestamp at time zone 'America/Sao_Paulo')
    union all
    select r.id,'legacy',0,r.points_cost,(r.created_at at time zone 'America/Sao_Paulo')::date
    from public.loyalty_redemptions r where r.status <> 'rejected'
      and r.created_at >= (p_from::timestamp at time zone 'America/Sao_Paulo')
      and r.created_at < ((p_to+1)::timestamp at time zone 'America/Sao_Paulo')
  ), sold as materialized (
    select i.reward_id,i.name,i.quantity,i.unit_cash,i.unit_coins,i.unit_internal_cost
    from paid p join public.store_order_items i on p.source='store' and i.order_id=p.id
    union all
    select r.reward_id,r.reward_name,1,0,r.points_cost,null::numeric
    from paid p join public.loyalty_redemptions r on p.source='legacy' and r.id=p.id
  ), daily as (
    select day,sum(cash_total) as cash,count(*) as orders from paid group by day
  ), calendar as (
    select p_from+n as day from generate_series(0,p_to-p_from) n
  ), top_products as (
    select reward_id,min(name) as name,sum(quantity) as units,sum(quantity*unit_cash) as cash,
      sum(quantity*unit_coins) as coins
    from sold group by reward_id,case when reward_id is null then name else null end
    order by sum(quantity) desc,min(name),reward_id limit 5
  ), stages as (
    select case when payment_status in ('partially_refunded','payment_review') then 'review'
      when payment_status='paid' and fulfillment_status='awaiting' then 'to-fulfill'
      when payment_status='paid' and fulfillment_status='processing' then 'processing' else 'other' end as stage
    from public.store_orders
    union all
    select case status when 'pending' then 'to-fulfill' when 'approved' then 'processing' else 'other' end
    from public.loyalty_redemptions
  )
  select jsonb_build_object(
    'active',coalesce((select active from public.loyalty_settings where id=true),false),
    'metrics',jsonb_build_object(
      'cash',coalesce((select sum(cash_total) from paid),0),
      'coins',coalesce((select sum(coins_total) from paid),0),
      'orders',(select count(*) from paid),
      'known_cost',coalesce((select sum(quantity*unit_internal_cost) from sold),0),
      'missing_cost_units',coalesce((select sum(quantity) from sold where unit_internal_cost is null),0)
    ),
    'operations',jsonb_build_object(
      'to-fulfill',(select count(*) from stages where stage='to-fulfill'),
      'processing',(select count(*) from stages where stage='processing'),
      'review',(select count(*) from stages where stage='review'),
      'low-stock',(select count(*) from public.loyalty_rewards where not archived and stock > 0 and stock <= low_stock_threshold)
    ),
    'chart',coalesce((select jsonb_agg(jsonb_build_object('day',c.day,'cash',coalesce(d.cash,0),'orders',coalesce(d.orders,0)) order by c.day)
      from calendar c left join daily d on d.day=c.day),'[]'::jsonb),
    'top_products',coalesce((select jsonb_agg(to_jsonb(t) order by t.units desc,t.name,t.reward_id) from top_products t),'[]'::jsonb),
    'alerts',jsonb_build_object(
      'missing-photo',(select count(*) from public.loyalty_rewards where not archived and image_path is null),
      'missing-cost',(select count(*) from public.loyalty_rewards where not archived and internal_cost is null),
      'sold-out',(select count(*) from public.loyalty_rewards where not archived and stock=0)
    ),
    'recent',public.get_admin_order_history(p_from=>p_from,p_to=>p_to,p_size=>5)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.get_store_dashboard(date,date) from public,anon;
grant execute on function public.get_store_dashboard(date,date) to authenticated;
create or replace function public.get_store_catalog(p_query text default '',p_status text default 'all',p_category text default '',p_payment text default '',p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not public.is_admin() then raise exception 'Acesso negado.'; end if;
  with filtered as (
    select r.* from public.loyalty_rewards r
    where (coalesce(p_query,'') = '' or position(lower(left(p_query,100)) in lower(r.name || ' ' || r.sku)) > 0)
      and (coalesce(p_category,'') = '' or r.category = p_category)
      and (coalesce(p_payment,'') = '' or (p_payment = 'cash' and r.cash_price is not null)
        or (p_payment = 'coins' and r.points_cost is not null) or (p_payment = 'mixed' and r.mixed_cash_price is not null))
      and (p_status = 'all' or (p_status = 'published' and r.active)
        or (p_status = 'missing-photo' and r.image_path is null and not r.archived)
        or (p_status = 'missing-cost' and r.internal_cost is null and not r.archived)
        or (p_status = 'draft' and not r.active and not r.archived)
        or (p_status = 'archived' and r.archived)
        or (p_status = 'sold-out' and r.stock = 0 and not r.archived)
        or (p_status = 'low-stock' and r.stock > 0 and r.stock <= r.low_stock_threshold and not r.archived))
  ), page_rows as (
    select * from filtered order by created_at desc,id limit 25 offset (greatest(1,least(coalesce(p_page,1),100000)) - 1) * 25
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object('reserved',coalesce(q.quantity,0)) order by p.created_at desc,p.id)
      from page_rows p left join public.get_store_reserved_quantities() q on q.reward_id = p.id),'[]'::jsonb),
    'total',(select count(*) from filtered),
    'counts',(select jsonb_build_object('all',count(*),'published',count(*) filter(where active),
      'missing-photo',count(*) filter(where image_path is null and not archived),
      'missing-cost',count(*) filter(where internal_cost is null and not archived),
      'draft',count(*) filter(where not active and not archived),'archived',count(*) filter(where archived),
      'sold-out',count(*) filter(where stock = 0 and not archived),
      'low-stock',count(*) filter(where stock > 0 and stock <= low_stock_threshold and not archived)) from public.loyalty_rewards),
    'categories',coalesce((select jsonb_agg(c.category order by c.category) from (select distinct category from public.loyalty_rewards) c),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.get_store_catalog(text,text,text,text,integer) from public,anon;
grant execute on function public.get_store_catalog(text,text,text,text,integer) to authenticated;

commit;

