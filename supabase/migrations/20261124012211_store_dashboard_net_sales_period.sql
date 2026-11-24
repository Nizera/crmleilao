create function public.get_store_dashboard_period(p_start timestamptz, p_end timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
  p_from date := (p_start at time zone 'America/Sao_Paulo')::date;
  p_to date := ((p_end - interval '1 microsecond') at time zone 'America/Sao_Paulo')::date;
begin
  if not public.is_admin() then raise exception 'Acesso negado.'; end if;
  if p_start is null or p_end is null or p_start >= p_end or p_to-p_from > 365 then
    raise exception 'Selecione um período válido de até 366 dias.';
  end if;
  with paid as materialized (
    select o.id,'store'::text as source,o.cash_total - o.freight_amount as cash_total, o.coins_total,
      o.freight_amount, o.discount_cash, round((o.cash_total - o.freight_amount) * 0.01, 2) as api_fee,
      (coalesce(o.paid_at,o.created_at) at time zone 'America/Sao_Paulo')::date as day
    from public.store_orders o where o.payment_status='paid'
      and coalesce(o.paid_at,o.created_at) >= p_start
      and coalesce(o.paid_at,o.created_at) < p_end
    union all
    select r.id,'legacy',0,r.points_cost,0,0,0,(r.created_at at time zone 'America/Sao_Paulo')::date
    from public.loyalty_redemptions r where r.status <> 'rejected'
      and r.created_at >= p_start
      and r.created_at < p_end
  ), sold as materialized (
    select i.reward_id,i.name,i.quantity,i.unit_cash,i.unit_coins,i.unit_internal_cost
    from paid p join public.store_order_items i on p.source='store' and i.order_id=p.id
    union all
    select r.reward_id,r.reward_name,1,0,r.points_cost,null::numeric
    from paid p join public.loyalty_redemptions r on p.source='legacy' and r.id=p.id
  ), vouchers as (
    select count(*) as redeemed, coalesce(sum(coins_paid),0) as coins_spent
    from public.customer_store_vouchers
    where created_at >= p_start and created_at < p_end
  ), daily as (
    select day,sum(cash_total - api_fee) as cash,count(*) as orders from paid group by day
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
      'cash',coalesce((select sum(cash_total - api_fee) from paid),0),
      'api_fee',coalesce((select sum(api_fee) from paid),0),
      'freight_received',coalesce((select sum(freight_amount) from paid),0),
      'coins',coalesce((select sum(coins_total) from paid),0)+(select coins_spent from vouchers),
      'orders',(select count(*) from paid),
      'known_cost',coalesce((select sum(quantity*unit_internal_cost) from sold),0),
      'missing_cost_units',coalesce((select sum(quantity) from sold where unit_internal_cost is null),0)
    ),
    'vouchers',(select jsonb_build_object('redeemed',redeemed,'coins_spent',coins_spent,
      'discounts_used',coalesce((select sum(discount_cash) from paid),0)) from vouchers),
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
revoke all on function public.get_store_dashboard_period(timestamptz,timestamptz) from public,anon;
grant execute on function public.get_store_dashboard_period(timestamptz,timestamptz) to authenticated;
