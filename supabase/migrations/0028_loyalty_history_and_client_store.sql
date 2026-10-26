-- Históricos paginados, catálogo do cliente e ajustes administrativos idempotentes.
begin;
create function public.get_caracoins_history(p_query text default '',p_kind text default '',p_from date default null,p_to date default null,p_customer uuid default null,p_page integer default 1,p_size integer default 20)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_admin boolean:=coalesce(public.is_admin(),false); v_customer uuid:=public.current_customer_id(); v_result jsonb;
begin
 if not v_admin and (v_customer is null or (p_customer is not null and p_customer<>v_customer)) then raise exception 'Acesso negado.'; end if;
 if not v_admin then p_customer:=v_customer; end if;
 if p_kind not in ('','earned','spent','reversal','adjustment') then raise exception 'Filtro inválido.'; end if;
 p_size:=greatest(1,least(coalesce(p_size,20),50));
 with filtered as materialized (
 select l.id,l.points,l.kind,l.note,l.created_at,l.lot_value,l.earn_rate,l.store_order_id,l.lot_id,
   case when v_admin then c.name end as customer_name,case when v_admin then c.phone_e164 end as customer_phone
 from public.loyalty_ledger l join public.customers c on c.id=l.customer_id
 where (p_customer is null or l.customer_id=p_customer)
 and (p_kind='' or l.kind=p_kind)
 and (p_from is null or l.created_at >= (p_from::timestamp at time zone 'America/Sao_Paulo'))
 and (p_to is null or l.created_at < ((p_to+1)::timestamp at time zone 'America/Sao_Paulo'))
 and (coalesce(p_query,'')='' or (v_admin and strpos(lower(coalesce(c.name,'')||' '||coalesce(c.phone_e164,'')),lower(left(p_query,100)))>0)
 or strpos(lower(coalesce(l.note,'')),lower(left(p_query,100)))>0)
 ), totals as (
 select count(*) as total,coalesce(sum(points) filter(where points>0),0) as credits,
 coalesce(-sum(points) filter(where points<0),0) as debits,greatest(1,ceil(count(*)::numeric/p_size)::int) as pages from filtered
 ), paging as (select *,greatest(1,least(coalesce(p_page,1),pages)) as page from totals),
 page_rows as (select * from filtered order by created_at desc,id desc limit p_size offset(select (page-1)*p_size from paging))
 select jsonb_build_object('total',p.total,'credits',p.credits,'debits',p.debits,'page',p.page,'pages',p.pages,'size',p_size,
 'items',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id desc) from page_rows r),'[]'::jsonb))
 into v_result from paging p; return v_result;
end; $$;
revoke all on function public.get_caracoins_history(text,text,date,date,uuid,integer,integer) from public,anon;
grant execute on function public.get_caracoins_history(text,text,date,date,uuid,integer,integer) to authenticated;

create function public.search_loyalty_customers(p_query text)
returns table(id uuid,name text,phone_e164 text,balance numeric) language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'Acesso negado.'; end if;
 if char_length(trim(coalesce(p_query,'')))<2 then return; end if;
 return query select c.id,c.name,c.phone_e164,
 coalesce((select sum(l.points) from public.loyalty_ledger l where l.customer_id=c.id),0)
 from public.customers c where strpos(lower(coalesce(c.name,'')||' '||c.phone_e164),lower(left(trim(p_query),100)))>0
 order by c.name nulls last,c.id limit 20;
end; $$;
revoke all on function public.search_loyalty_customers(text) from public,anon;
grant execute on function public.search_loyalty_customers(text) to authenticated;

create table public.loyalty_manual_requests(
 id uuid primary key,actor uuid not null references auth.users(id),customer_id uuid not null references public.customers(id),
 points numeric(12,2) not null,note text not null,created_at timestamptz not null default now()
);
alter table public.loyalty_manual_requests enable row level security;
revoke all on public.loyalty_manual_requests from public,anon,authenticated;
grant all on public.loyalty_manual_requests to service_role;
create function public.adjust_caracoins_once(p_request uuid,p_customer uuid,p_points numeric,p_note text)
returns void language plpgsql security definer set search_path='' as $$
declare v_previous public.loyalty_manual_requests%rowtype;
begin
 if not public.has_staff_write() then raise exception 'Acesso negado.'; end if;
 if p_request is null or p_customer is null or p_points is null or p_points=0 or abs(p_points)>1000000
 or p_points<>round(p_points,2) or char_length(trim(coalesce(p_note,''))) not between 4 and 500 then raise exception 'Ajuste inválido.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request::text,0));
 select * into v_previous from public.loyalty_manual_requests where id=p_request;
 if found then
  if v_previous.actor<>auth.uid() or v_previous.customer_id<>p_customer or v_previous.points<>p_points or v_previous.note<>trim(p_note) then raise exception 'Solicitação já utilizada.'; end if;
  return;
 end if;
 perform public.adjust_loyalty_points(p_customer,p_points,trim(p_note));
 insert into public.loyalty_manual_requests(id,actor,customer_id,points,note) values(p_request,auth.uid(),p_customer,p_points,trim(p_note));
end; $$;
revoke all on function public.adjust_caracoins_once(uuid,uuid,numeric,text) from public,anon;
grant execute on function public.adjust_caracoins_once(uuid,uuid,numeric,text) to authenticated;

create function public.get_customer_order_history(p_status text default 'all',p_from date default null,p_to date default null,p_page integer default 1)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_customer uuid:=public.current_customer_id();v_result jsonb;
begin
 if v_customer is null then raise exception 'Acesso negado.'; end if;
 if p_status not in ('all','unpaid','preparing','fulfilled','closed') then raise exception 'Filtro inválido.'; end if;
 with normalized as (
 select o.id,'store'::text as source,o.code,o.created_at,o.cash_total,o.coins_total,o.payment_status,o.fulfillment_status,
 o.qr_code,o.qr_code_base64,o.ticket_url,o.expires_at,o.admin_note,null::text as legacy_status,null::text as reward_name,
 case when o.payment_status in ('creating','pending') then 'unpaid'
 when o.payment_status='paid' then case when o.fulfillment_status='fulfilled' then 'fulfilled' else 'preparing' end else 'closed' end as stage
 from public.store_orders o where o.customer_id=v_customer
 union all
 select r.id,'legacy','RES-'||upper(left(r.id::text,8)),r.created_at,0,r.points_cost,
 case when r.status='rejected' then 'cancelled' else 'paid' end,
 case when r.status='fulfilled' then 'fulfilled' when r.status='approved' then 'processing' else 'awaiting' end,
 null,null,null,null,r.admin_note,r.status,r.reward_name,
 case when r.status='fulfilled' then 'fulfilled' when r.status='rejected' then 'closed' else 'preparing' end
 from public.loyalty_redemptions r where r.customer_id=v_customer
 ), filtered as materialized (
 select * from normalized where (p_status='all' or stage=p_status)
 and (p_from is null or created_at >=(p_from::timestamp at time zone 'America/Sao_Paulo'))
 and (p_to is null or created_at <((p_to+1)::timestamp at time zone 'America/Sao_Paulo'))
 ), totals as (select count(*) as total,greatest(1,ceil(count(*)::numeric/10)::int) as pages from filtered),
 paging as(select *,greatest(1,least(coalesce(p_page,1),pages)) as page from totals),
 page_rows as(select * from filtered order by created_at desc,id desc limit 10 offset(select(page-1)*10 from paging))
 select jsonb_build_object('total',p.total,'page',p.page,'pages',p.pages,'size',10,'items',
 coalesce((select jsonb_agg((to_jsonb(r)-'reward_name'-'stage')||jsonb_build_object('items',
 case when r.source='legacy' then jsonb_build_array(jsonb_build_object('id',r.id,'name',r.reward_name,'quantity',1,'unit_cash',0,'unit_coins',r.coins_total))
 else coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'reward_id',i.reward_id,'name',i.name,'quantity',i.quantity,'image_path',i.image_path,'price_mode',i.price_mode,'unit_cash',i.unit_cash,'unit_coins',i.unit_coins) order by i.id)
 from public.store_order_items i where i.order_id=r.id),'[]'::jsonb) end) order by r.created_at desc,r.id desc) from page_rows r),'[]'::jsonb))
 into v_result from paging p; return v_result;
end; $$;
revoke all on function public.get_customer_order_history(text,date,date,integer) from public,anon;
grant execute on function public.get_customer_order_history(text,date,date,integer) to authenticated;

create function public.get_customer_store_catalog(p_query text default '',p_category text default '',p_mode text default '',p_sort text default 'newest',p_page integer default 1)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
 if public.current_customer_id() is null then raise exception 'Acesso negado.'; end if;
 with filtered as materialized (
 select id,name,description,points_cost,stock,image_path,image_paths,sku,category,cash_price,mixed_cash_price,mixed_points_cost,created_at
 from public.loyalty_rewards r where r.active and not r.archived and exists(select 1 from public.loyalty_settings where id=true and active)
 and (coalesce(p_query,'')='' or strpos(lower(r.name||' '||coalesce(r.description,'')),lower(left(p_query,100)))>0)
 and (coalesce(p_category,'')='' or category=p_category)
 and (coalesce(p_mode,'')='' or (p_mode='cash' and cash_price is not null) or(p_mode='coins' and points_cost is not null) or(p_mode='mixed' and mixed_cash_price is not null))
 ), totals as(select count(*) as total,greatest(1,ceil(count(*)::numeric/20)::int) as pages from filtered),
 paging as(select *,greatest(1,least(coalesce(p_page,1),pages)) as page from totals),
 page_rows as(select * from filtered order by
 case when p_sort='cash' then cash_price end asc nulls last,
 case when p_sort='coins' then points_cost end asc nulls last,created_at desc,id
 limit 20 offset(select(page-1)*20 from paging))
 select jsonb_build_object('total',p.total,'page',p.page,'pages',p.pages,'size',20,
 'categories',coalesce((select jsonb_agg(category order by category) from (select distinct category from public.loyalty_rewards where active and not archived) c),'[]'::jsonb),
 'items',coalesce((select jsonb_agg(to_jsonb(r) order by
 case when p_sort='cash' then r.cash_price end asc nulls last,
 case when p_sort='coins' then r.points_cost end asc nulls last,r.created_at desc,r.id) from page_rows r),'[]'::jsonb))
 into v_result from paging p; return v_result;
end; $$;
revoke all on function public.get_customer_store_catalog(text,text,text,text,integer) from public,anon;
grant execute on function public.get_customer_store_catalog(text,text,text,text,integer) to authenticated;
commit;

