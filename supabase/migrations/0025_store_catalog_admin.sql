-- Requer 0024: catálogo de e-commerce, galeria, SKU, categorias e operações em lote.
begin;
alter table public.loyalty_rewards
  add column sku text,
  add column category text not null default 'Sem categoria',
  add column image_paths text[] not null default '{}',
  add column archived boolean not null default false,
  add column low_stock_threshold integer default 5 check (low_stock_threshold between 0 and 1000000),
  add constraint store_sku_format check (sku ~ '^[A-Z0-9][A-Z0-9._-]{0,47}$'),
  add constraint store_category_length check (char_length(category) between 1 and 60),
  add constraint store_gallery_count check (cardinality(image_paths) <= 6),
  add constraint store_gallery_flat check (cardinality(image_paths) = 0 or array_ndims(image_paths) = 1),
  add constraint store_archive_publication check (not (archived and active));
update public.loyalty_rewards set sku = 'PRD-' || upper(replace(id::text,'-','')),
  image_paths = case when image_path is null then '{}'::text[] else array[image_path] end;
alter table public.loyalty_rewards alter column sku set not null;
create unique index store_product_sku_unique on public.loyalty_rewards(sku);
create index store_products_category on public.loyalty_rewards(category);
create index store_order_items_reward on public.store_order_items(reward_id);

create function public.validate_store_product_details()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_path text;
begin
  new.sku := upper(trim(coalesce(nullif(new.sku,''),'PRD-' || replace(new.id::text,'-',''))));
  new.category := coalesce(nullif(trim(new.category),''),'Sem categoria');
  new.image_paths := coalesce(new.image_paths,'{}'::text[]);
  -- Compatibilidade com formulários anteriores que alteravam só a capa.
  if tg_op = 'INSERT' and cardinality(new.image_paths) = 0 and new.image_path is not null then
    new.image_paths := array[new.image_path];
  elsif tg_op = 'UPDATE' then
    if new.image_paths is not distinct from old.image_paths and new.image_path is distinct from old.image_path then
      new.image_paths := array_remove(array_remove(old.image_paths,old.image_path),new.image_path);
      if new.image_path is not null then new.image_paths := array_prepend(new.image_path,new.image_paths); end if;
    end if;
  end if;
  foreach v_path in array new.image_paths loop
    if v_path is null or v_path !~ ('^loyalty-rewards/' || new.id::text || '/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp|avif)$') then
      raise exception 'Imagem inválida para este produto.';
    end if;
  end loop;
  if cardinality(new.image_paths) <> (select count(distinct p) from unnest(new.image_paths) p) then
    raise exception 'A galeria não pode conter imagens duplicadas.';
  end if;
  new.image_path := new.image_paths[1];
  return new;
end;
$$;
create trigger store_product_details before insert or update on public.loyalty_rewards
for each row execute function public.validate_store_product_details();
grant select(sku,category,image_paths,archived) on public.loyalty_rewards to authenticated;

create function public.get_store_reserved_quantities()
returns table(reward_id uuid,quantity bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado.'; end if;
  return query select i.reward_id,sum(i.quantity)::bigint
    from public.store_order_items i join public.store_orders o on o.id = i.order_id
    where o.resources_released_at is null and o.fulfillment_status <> 'fulfilled'
      and o.payment_status in ('creating','pending','paid','partially_refunded')
      and i.reserved_stock group by i.reward_id;
end;
$$;
revoke all on function public.get_store_reserved_quantities() from public,anon;
grant execute on function public.get_store_reserved_quantities() to authenticated;

create function public.get_store_catalog(p_query text default '',p_status text default 'all',p_category text default '',p_payment text default '',p_page integer default 1)
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

create function public.bulk_store_products(p_products jsonb,p_action text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_product record; v_version timestamptz; v_count integer := 0;
begin
  if not public.has_staff_write() then raise exception 'Acesso negado.'; end if;
  if p_action is null or p_action not in ('publish','draft','archive') then raise exception 'Ação inválida.'; end if;
  if jsonb_typeof(p_products) is distinct from 'array' or jsonb_array_length(p_products) not between 1 and 100 then
    raise exception 'Selecione de 1 a 100 produtos.';
  end if;
  if (select count(distinct x.id) from jsonb_to_recordset(p_products) x(id uuid)) <> jsonb_array_length(p_products) then
    raise exception 'Seleção inválida.';
  end if;
  for v_product in select * from jsonb_to_recordset(p_products) x(id uuid,updated_at timestamptz) order by id loop
    select updated_at into v_version from public.loyalty_rewards where id = v_product.id for update;
    if not found or v_product.updated_at is distinct from v_version then raise exception 'Um produto mudou. Atualize o catálogo antes de continuar.'; end if;
    update public.loyalty_rewards set active = (p_action = 'publish'),archived = (p_action = 'archive') where id = v_product.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.bulk_store_products(jsonb,text) from public,anon;
grant execute on function public.bulk_store_products(jsonb,text) to authenticated;

create table public.store_catalog_imports (
  id uuid primary key,created_by uuid references auth.users(id) on delete set null,
  payload_hash text not null,rows_count integer not null,created_at timestamptz not null default now()
);
alter table public.store_catalog_imports enable row level security;
revoke all on public.store_catalog_imports from public,anon,authenticated;
grant select on public.store_catalog_imports to authenticated;
grant all on public.store_catalog_imports to service_role;
create policy store_catalog_imports_staff on public.store_catalog_imports for select to authenticated using(public.is_admin());

create function public.import_store_products(p_rows jsonb,p_request_key uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_row record; v_count integer := 0; v_previous public.store_catalog_imports%rowtype;
begin
  if not public.has_staff_write() then raise exception 'Acesso negado.'; end if;
  if p_request_key is null then raise exception 'Chave de importação inválida.'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 200 then
    raise exception 'Importe de 1 a 200 produtos por arquivo.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('store-catalog-import',0));
  select * into v_previous from public.store_catalog_imports where id = p_request_key;
  if found then
    if v_previous.created_by is distinct from auth.uid() or v_previous.payload_hash <> md5(p_rows::text) then
      raise exception 'A chave de importação já foi usada com outro arquivo.';
    end if;
    return v_previous.rows_count;
  end if;
  for v_row in select * from jsonb_to_recordset(p_rows) x(name text,description text,sku text,category text,points_cost integer,cash_price numeric,mixed_cash_price numeric,mixed_points_cost integer,internal_cost numeric,stock integer,low_stock_threshold integer) loop
    if v_row.name is null or char_length(trim(v_row.name)) not between 2 and 120
      or char_length(coalesce(v_row.description,'')) > 2000 then raise exception 'Nome ou descrição inválidos na importação.'; end if;
    insert into public.loyalty_rewards(name,description,sku,category,points_cost,cash_price,mixed_cash_price,mixed_points_cost,internal_cost,stock,low_stock_threshold,active,created_by)
    values(trim(v_row.name),v_row.description,nullif(v_row.sku,''),coalesce(nullif(v_row.category,''),'Sem categoria'),v_row.points_cost,
      v_row.cash_price,v_row.mixed_cash_price,v_row.mixed_points_cost,v_row.internal_cost,v_row.stock,v_row.low_stock_threshold,false,auth.uid());
    v_count := v_count + 1;
  end loop;
  insert into public.store_catalog_imports(id,created_by,payload_hash,rows_count)
    values(p_request_key,auth.uid(),md5(p_rows::text),v_count);
  return v_count;
end;
$$;
revoke all on function public.import_store_products(jsonb,uuid) from public,anon;
grant execute on function public.import_store_products(jsonb,uuid) to authenticated;
commit;
