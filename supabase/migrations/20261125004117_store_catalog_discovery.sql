begin;

create function public.store_search_normalize(value text)
returns text language sql immutable strict set search_path='' as $$
  select trim(regexp_replace(
    translate(lower(value),'���Ƅ�����������䔣�����','aaaaaeeeeiiiiooooouuuucn'),
    '[^a-z0-9]+',' ','g'))
$$;
revoke all on function public.store_search_normalize(text) from public, anon, authenticated;

create or replace function public.get_public_store_catalog(p_query text default '',p_category text default '',p_mode text default '',p_sort text default 'newest',p_page integer default 1,p_min numeric default null,p_max numeric default null,p_available boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 result jsonb;
 search_query text := public.store_search_normalize(left(coalesce(p_query,''),100));
begin
 search_query := regexp_replace(search_query, '\m(cr7|cr 7)\M', 'cristiano ronaldo', 'g');
 search_query := regexp_replace(search_query, '\m(vini jr|vini junior)\M', 'vinicius junior', 'g');

 if p_min<0 or p_max<0 or p_min>9999999 or p_max>9999999 or p_min>p_max then raise exception 'Faixa de pre�o inv�lida.';end if;
 if (p_min is not null or p_max is not null) and coalesce(p_mode,'') not in ('cash','coins') then raise exception 'Escolha a moeda para filtrar o pre�o.';end if;
 with catalog as materialized (
 select id,name,description,delivery_kind,points_cost,stock,image_path,image_paths,sku,category,cash_price,created_at
 from public.loyalty_rewards where active and not archived and mixed_cash_price is null and mixed_points_cost is null
 and ((cash_price>0 and points_cost is null) or(points_cost>0 and cash_price is null))
 and exists(select 1 from public.loyalty_settings where id=true and active)
 ), filtered as materialized (
 select * from catalog r where (search_query='' or not exists (
   select 1 from unnest(string_to_array(search_query,' ')) as q(word)
   where strpos(public.store_search_normalize(concat_ws(' ',r.name,r.description,r.sku)),q.word)=0
 ))
 and(coalesce(p_category,'')='' or category=p_category)
 and(coalesce(p_mode,'')='' or(p_mode='cash' and cash_price>0) or(p_mode='coins' and points_cost>0))
 and(not coalesce(p_available,false) or stock is null or stock>0)
 and(p_min is null or case when p_mode='cash' then cash_price else points_cost end>=p_min)
 and(p_max is null or case when p_mode='cash' then cash_price else points_cost end<=p_max)
 ), counted as(select count(*) total,greatest(1,ceil(count(*)::numeric/20)::int) pages from filtered),
 paging as(select *,greatest(1,least(coalesce(p_page,1),pages)) page from counted),
 ordered as(select *,row_number() over(order by
 case when coalesce(p_sort,'newest')='newest' and stock<=0 then 1 else 0 end,
 case when p_sort='cash' then cash_price end asc nulls last,case when p_sort='cash_desc' then cash_price end desc nulls last,
 case when p_sort='coins' then points_cost end asc nulls last,case when p_sort='coins_desc' then points_cost end desc nulls last,
 case when p_sort='name' then lower(name) end asc,created_at desc,id) position from filtered),
 rows as(select * from ordered order by position limit 20 offset(select(page-1)*20 from paging))
 select jsonb_build_object('total',p.total,'page',p.page,'pages',p.pages,'size',20,
 'categories',coalesce((select jsonb_agg(category order by category) from(select distinct category from catalog where coalesce(category,'')<>'') c),'[]'::jsonb),
 'items',coalesce((select jsonb_agg(to_jsonb(r)-'position' order by position) from rows r),'[]'::jsonb)) into result from paging p;
 return result;
end $$;

create or replace function public.get_customer_store_catalog_v2(p_query text default '',p_category text default '',p_mode text default '',p_sort text default 'newest',p_page integer default 1,p_min numeric default null,p_max numeric default null,p_available boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 result jsonb;
 search_query text := public.store_search_normalize(left(coalesce(p_query,''),100));
begin
 search_query := regexp_replace(search_query, '\m(cr7|cr 7)\M', 'cristiano ronaldo', 'g');
 search_query := regexp_replace(search_query, '\m(vini jr|vini junior)\M', 'vinicius junior', 'g');
 if public.current_customer_id() is null then raise exception 'Acesso negado.';end if;
 if p_min<0 or p_max<0 or p_min>9999999 or p_max>9999999 or p_min>p_max then raise exception 'Faixa de pre�o inv�lida.';end if;
 if (p_min is not null or p_max is not null) and coalesce(p_mode,'') not in ('cash','coins') then raise exception 'Escolha a moeda para filtrar o pre�o.';end if;
 with catalog as materialized (
 select id,name,description,delivery_kind,points_cost,stock,image_path,image_paths,sku,category,cash_price,created_at
 from public.loyalty_rewards where active and not archived and mixed_cash_price is null and mixed_points_cost is null
 and ((cash_price>0 and points_cost is null) or(points_cost>0 and cash_price is null))
 and exists(select 1 from public.loyalty_settings where id=true and active)
 ), filtered as materialized (
 select * from catalog r where (search_query='' or not exists (
   select 1 from unnest(string_to_array(search_query,' ')) as q(word)
   where strpos(public.store_search_normalize(concat_ws(' ',r.name,r.description,r.sku)),q.word)=0
 ))
 and(coalesce(p_category,'')='' or category=p_category)
 and(coalesce(p_mode,'')='' or(p_mode='cash' and cash_price>0) or(p_mode='coins' and points_cost>0))
 and(not coalesce(p_available,false) or stock is null or stock>0)
 and(p_min is null or case when p_mode='cash' then cash_price else points_cost end>=p_min)
 and(p_max is null or case when p_mode='cash' then cash_price else points_cost end<=p_max)
 ), counted as(select count(*) total,greatest(1,ceil(count(*)::numeric/20)::int) pages from filtered),
 paging as(select *,greatest(1,least(coalesce(p_page,1),pages)) page from counted),
 ordered as(select *,row_number() over(order by
 case when coalesce(p_sort,'newest')='newest' and stock<=0 then 1 else 0 end,
 case when p_sort='cash' then cash_price end asc nulls last,case when p_sort='cash_desc' then cash_price end desc nulls last,
 case when p_sort='coins' then points_cost end asc nulls last,case when p_sort='coins_desc' then points_cost end desc nulls last,
 case when p_sort='name' then lower(name) end asc,created_at desc,id) position from filtered),
 rows as(select * from ordered order by position limit 20 offset(select(page-1)*20 from paging))
 select jsonb_build_object('total',p.total,'page',p.page,'pages',p.pages,'size',20,
 'categories',coalesce((select jsonb_agg(category order by category) from(select distinct category from catalog where coalesce(category,'')<>'') c),'[]'::jsonb),
 'items',coalesce((select jsonb_agg(to_jsonb(r)-'position' order by position) from rows r),'[]'::jsonb)) into result from paging p;
 return result;
end $$;

commit;

