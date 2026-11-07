-- Leitura pública com projeção limitada. Nenhuma permissão de compra é alterada.
begin;
create or replace function public.get_public_store_catalog(p_query text default '',p_category text default '',p_mode text default '',p_sort text default 'newest',p_page integer default 1,p_min numeric default null,p_max numeric default null,p_available boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin

 if p_min<0 or p_max<0 or p_min>9999999 or p_max>9999999 or p_min>p_max then raise exception 'Faixa de preço inválida.';end if;
 if (p_min is not null or p_max is not null) and coalesce(p_mode,'') not in ('cash','coins') then raise exception 'Escolha a moeda para filtrar o preço.';end if;
 with catalog as materialized (
 select id,name,description,delivery_kind,points_cost,stock,image_path,image_paths,sku,category,cash_price,created_at
 from public.loyalty_rewards where active and not archived and mixed_cash_price is null and mixed_points_cost is null
 and ((cash_price>0 and points_cost is null) or(points_cost>0 and cash_price is null))
 and exists(select 1 from public.loyalty_settings where id=true and active)
 ), filtered as materialized (
 select * from catalog r where (coalesce(p_query,'')='' or strpos(lower(r.name||' '||coalesce(r.description,'')||' '||coalesce(r.sku,'')),lower(left(p_query,100)))>0)
 and(coalesce(p_category,'')='' or category=p_category)
 and(coalesce(p_mode,'')='' or(p_mode='cash' and cash_price>0) or(p_mode='coins' and points_cost>0))
 and(not coalesce(p_available,false) or stock is null or stock>0)
 and(p_min is null or case when p_mode='cash' then cash_price else points_cost end>=p_min)
 and(p_max is null or case when p_mode='cash' then cash_price else points_cost end<=p_max)
 ), counted as(select count(*) total,greatest(1,ceil(count(*)::numeric/20)::int) pages from filtered),
 paging as(select *,greatest(1,least(coalesce(p_page,1),pages)) page from counted),
 ordered as(select *,row_number() over(order by
 case when p_sort='cash' then cash_price end asc nulls last,case when p_sort='cash_desc' then cash_price end desc nulls last,
 case when p_sort='coins' then points_cost end asc nulls last,case when p_sort='coins_desc' then points_cost end desc nulls last,
 case when p_sort='name' then lower(name) end asc,created_at desc,id) position from filtered),
 rows as(select * from ordered order by position limit 20 offset(select(page-1)*20 from paging))
 select jsonb_build_object('total',p.total,'page',p.page,'pages',p.pages,'size',20,
 'categories',coalesce((select jsonb_agg(category order by category) from(select distinct category from catalog where coalesce(category,'')<>'') c),'[]'::jsonb),
 'items',coalesce((select jsonb_agg(to_jsonb(r)-'position' order by position) from rows r),'[]'::jsonb)) into result from paging p;
 return result;
end $$;

create or replace function public.get_public_raffle_detail(p_campaign uuid,p_from integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.raffle_campaigns%rowtype;
begin

 select * into c from public.raffle_campaigns where id=p_campaign and status in ('open','paused','closed') and archived_at is null;
 if not found then raise exception 'Campanha não encontrada.'; end if;
 return jsonb_build_object('campaign',(select to_jsonb(v) from(select c.id,c.title,c.description,c.total_numbers,c.unit_price,c.selection_mode,c.draw_method,c.draw_rules,c.shipping_date,c.image_url,c.image_urls,c.hide_winning_numbers,c.min_quantity,c.max_quantity,c.status,c.created_at) v),
 'paid',(select count(*) from public.raffle_allocations a join public.raffle_orders o on o.id=a.order_id where a.campaign_id=c.id and o.status='paid'),
 'reserved',(select count(*) from public.raffle_allocations a join public.raffle_orders o on o.id=a.order_id where a.campaign_id=c.id and o.status<>'paid'),
 'prizes',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'kind',p.kind,'image_urls',p.image_urls,'number',case when not c.hide_winning_numbers then p.number else null end,'found',exists(select 1 from public.raffle_awards a where a.prize_id=p.id)) order by p.kind,p.id),'[]') from public.raffle_prizes p where campaign_id=c.id),
 'results',(select coalesce(jsonb_agg(jsonb_build_object('title',p.title,'number',a.number,'note',a.result_note,'evidence',a.evidence_url,'status',o.status)),'[]') from public.raffle_awards a join public.raffle_prizes p on p.id=a.prize_id join public.raffle_orders o on o.id=a.order_id where a.campaign_id=c.id and p.kind='main'),
 'numbers',(select coalesce(jsonb_agg(jsonb_build_object('number',g,'state',case when o.status='paid' then 'paid' when a.order_id is not null then 'reserved' else 'available' end) order by g),'[]') from generate_series(greatest(0,least(p_from,c.total_numbers-1)),least(c.total_numbers-1,greatest(0,p_from)+99)) g left join public.raffle_allocations a on a.campaign_id=c.id and a.number=g left join public.raffle_orders o on o.id=a.order_id));
end; $$;

create or replace function public.get_public_raffles(p_query text default '',p_page integer default 1,p_closed boolean default false) returns jsonb language sql stable security definer set search_path='' as $$
 with filtered as(select id,title,description,total_numbers,unit_price,selection_mode,draw_method,draw_rules,shipping_date,image_url,image_urls,hide_winning_numbers,min_quantity,max_quantity,status,created_at from public.raffle_campaigns where archived_at is null and status=any(case when p_closed then array['closed'] else array['open','paused'] end) and (coalesce(p_query,'')='' or strpos(lower(title),lower(left(p_query,100)))>0)), counted as(select count(*) total from filtered)
 select jsonb_build_object('total',(select total from counted),'items',coalesce((select jsonb_agg(to_jsonb(r)) from (select * from filtered order by created_at desc,id limit 10 offset (greatest(1,least(coalesce(p_page,1),10000))-1)*10) r),'[]'::jsonb));
$$;
revoke all on function public.get_public_store_catalog(text,text,text,text,integer,numeric,numeric,boolean),public.get_public_raffle_detail(uuid,integer),public.get_public_raffles(text,integer,boolean) from public;
grant execute on function public.get_public_store_catalog(text,text,text,text,integer,numeric,numeric,boolean),public.get_public_raffle_detail(uuid,integer),public.get_public_raffles(text,integer,boolean) to anon,authenticated;
commit;
