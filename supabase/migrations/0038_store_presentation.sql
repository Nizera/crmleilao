-- Vitrine, banner administrável e filtros aplicados antes da paginação.
begin;
create table public.store_banner (
 id boolean primary key default true check(id),
 title text not null default 'Sua coleção merece o próximo destaque.' check(length(title) between 2 and 100),
 subtitle text not null default 'Explore nossos colecionáveis.' check(length(subtitle)<=220),
 button_label text not null default 'Explorar produtos' check(length(button_label) between 2 and 32),
 button_href text not null default '#catalogo-loja' check(button_href='#catalogo-loja' or button_href ~ '^/painel/loja(\?[a-zA-Z0-9%&=+_.~-]*)?$'),
 desktop_path text check(desktop_path ~ '^store-banners/[a-f0-9-]+\.(webp|png|jpg)$'),
 mobile_path text check(mobile_path ~ '^store-banners/[a-f0-9-]+\.(webp|png|jpg)$'),
 active boolean not null default true,
 updated_at timestamptz not null default now()
);
insert into public.store_banner(id) values(true);
alter table public.store_banner enable row level security;
revoke all on public.store_banner from anon,authenticated;
grant select on public.store_banner to authenticated;
grant all on public.store_banner to service_role;
create policy store_banner_read on public.store_banner for select to authenticated using(public.is_admin() or (active and public.current_customer_id() is not null));

create function public.get_customer_store_catalog_v2(p_query text default '',p_category text default '',p_mode text default '',p_sort text default 'newest',p_page integer default 1,p_min numeric default null,p_max numeric default null,p_available boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if public.current_customer_id() is null then raise exception 'Acesso negado.';end if;
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
revoke all on function public.get_customer_store_catalog_v2(text,text,text,text,integer,numeric,numeric,boolean) from public,anon;
grant execute on function public.get_customer_store_catalog_v2(text,text,text,text,integer,numeric,numeric,boolean) to authenticated;
commit;
