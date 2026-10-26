-- Histórico unificado da loja: paginação e filtros no banco, incluindo resgates antigos.
begin;
create index if not exists store_orders_created_id_idx on public.store_orders(created_at desc,id desc);
create index if not exists loyalty_redemptions_created_id_idx on public.loyalty_redemptions(created_at desc,id desc);

create function public.get_admin_order_history(
  p_query text default '', p_status text default 'all', p_source text default 'all',
  p_from date default null, p_to date default null, p_page integer default 1, p_size integer default 20
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not public.is_admin() then raise exception 'Acesso negado.'; end if;
  if p_status not in ('all','to-fulfill','processing','unpaid','fulfilled','review','closed')
    or p_source not in ('all','store','legacy') then raise exception 'Filtro inválido.'; end if;
  if p_from > p_to then raise exception 'Período inválido.'; end if;
  p_size := greatest(1,least(coalesce(p_size,20),50));
  p_query := left(trim(coalesce(p_query,'')),100);
  with normalized as (
    select o.id,'store'::text as source,o.code,o.customer_id,o.created_at,o.cash_total,o.coins_total,
      o.payment_status,o.fulfillment_status,o.admin_note,null::text as customer_note,
      case when o.payment_status in ('partially_refunded','payment_review') then 'review'
        when o.payment_status in ('creating','pending') then 'unpaid'
        when o.payment_status <> 'paid' then 'closed'
        when o.fulfillment_status = 'fulfilled' then 'fulfilled'
        when o.fulfillment_status = 'processing' then 'processing' else 'to-fulfill' end as stage,
      null::text as legacy_status,null::text as reward_name
    from public.store_orders o
    union all
    select r.id,'legacy','RES-'||upper(left(r.id::text,8)),r.customer_id,r.created_at,0,r.points_cost,
      case when r.status = 'rejected' then 'cancelled' else 'paid' end,
      case when r.status = 'fulfilled' then 'fulfilled' when r.status = 'approved' then 'processing' else 'awaiting' end,
      r.admin_note,r.customer_note,
      case r.status when 'pending' then 'to-fulfill' when 'approved' then 'processing'
        when 'fulfilled' then 'fulfilled' else 'closed' end,r.status,r.reward_name
    from public.loyalty_redemptions r
  ), searched as materialized (
    select n.*,c.name as customer_name,c.phone_e164 as customer_phone
    from normalized n left join public.customers c on c.id=n.customer_id
    where (p_source = 'all' or n.source = p_source)
      and (p_from is null or n.created_at >= (p_from::timestamp at time zone 'America/Sao_Paulo'))
      and (p_to is null or n.created_at < ((p_to+1)::timestamp at time zone 'America/Sao_Paulo'))
      and (p_query = '' or strpos(lower(n.code),lower(p_query)) > 0
        or strpos(lower(coalesce(c.name,'')),lower(p_query)) > 0
        or strpos(coalesce(c.phone_e164,''),p_query) > 0
        or strpos(lower(coalesce(n.reward_name,'')),lower(p_query)) > 0)
  ), filtered as materialized (
    select * from searched where p_status = 'all' or stage = p_status
  ), totals as (
    select count(*) as total,greatest(1,ceil(count(*)::numeric/p_size)::integer) as pages from filtered
  ), paging as (
    select *,greatest(1,least(coalesce(p_page,1),pages)) as page from totals
  ), page_rows as (
    select f.* from filtered f order by f.created_at desc,f.id desc
    limit p_size offset (select (page-1)*p_size from paging)
  )
  select jsonb_build_object(
    'total',p.total,'page',p.page,'pages',p.pages,'size',p_size,
    'counts',jsonb_build_object('all',(select count(*) from searched),
      'to-fulfill',(select count(*) from searched where stage='to-fulfill'),
      'processing',(select count(*) from searched where stage='processing'),
      'unpaid',(select count(*) from searched where stage='unpaid'),
      'fulfilled',(select count(*) from searched where stage='fulfilled'),
      'review',(select count(*) from searched where stage='review'),
      'closed',(select count(*) from searched where stage='closed')),
    'items',coalesce((select jsonb_agg((to_jsonb(r) - 'reward_name') || jsonb_build_object('items',
      case when r.source='legacy' then jsonb_build_array(jsonb_build_object('id',r.id,'name',r.reward_name,'quantity',1,'unit_cash',0,'unit_coins',r.coins_total))
      else coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'quantity',i.quantity,'unit_cash',i.unit_cash,'unit_coins',i.unit_coins) order by i.id)
        from public.store_order_items i where i.order_id=r.id),'[]'::jsonb) end)
      order by r.created_at desc,r.id desc) from page_rows r),'[]'::jsonb)
  ) into v_result from paging p;
  return v_result;
end;
$$;
revoke all on function public.get_admin_order_history(text,text,text,date,date,integer,integer) from public,anon;
grant execute on function public.get_admin_order_history(text,text,text,date,date,integer,integer) to authenticated;
commit;
