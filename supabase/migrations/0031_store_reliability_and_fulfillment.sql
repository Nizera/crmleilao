-- Aplicar após 0030, antes de publicar o app. Não altera pagamentos já confirmados.
begin;

alter table public.loyalty_rewards add column delivery_kind text not null default 'physical'
  check(delivery_kind in ('physical','digital'));
grant select(delivery_kind) on public.loyalty_rewards to authenticated;
alter table public.store_order_items add column delivery_kind text not null default 'physical'
  check(delivery_kind in ('physical','digital'));
grant select(delivery_kind) on public.store_order_items to authenticated;
alter table public.store_orders
  add column boxed_at timestamptz,
  add column shipment_id uuid references public.shipments(id) on delete restrict,
  add column reconciliation_checked_at timestamptz,
  add column reconciliation_error text;
create index store_reconciliation_queue on public.store_orders(reconciliation_checked_at nulls first,created_at)
  where payment_status in ('creating','pending');
create index store_box_queue on public.store_orders(customer_id,created_at)
  where payment_status='paid' and fulfillment_status<>'fulfilled' and shipment_id is null;

create or replace function public.snapshot_store_item_cost()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  select r.internal_cost,r.delivery_kind into new.unit_internal_cost,new.delivery_kind
  from public.loyalty_rewards r where r.id=new.reward_id;
  return new;
end; $$;

create table public.store_order_events(
  id bigint generated always as identity primary key,
  order_id uuid not null references public.store_orders(id) on delete restrict,
  actor uuid references auth.users(id) on delete set null,
  happened_at timestamptz not null default clock_timestamp(),
  payment_before text,payment_after text not null,
  fulfillment_before text,fulfillment_after text not null,
  boxed_at timestamptz,shipment_id uuid,note text
);
create index store_events_order on public.store_order_events(order_id,happened_at,id);
alter table public.store_order_events enable row level security;
revoke all on public.store_order_events from public,anon,authenticated;
grant select on public.store_order_events to authenticated;
grant select on public.store_order_events to service_role;
create policy store_events_staff on public.store_order_events for select to authenticated using(public.is_admin());
create function public.audit_store_order()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    insert into public.store_order_events(order_id,actor,payment_after,fulfillment_after,boxed_at,shipment_id,note)
    values(new.id,auth.uid(),new.payment_status,new.fulfillment_status,new.boxed_at,new.shipment_id,new.admin_note);
  elsif row(new.payment_status,new.fulfillment_status,new.boxed_at,new.shipment_id,new.admin_note)
    is distinct from row(old.payment_status,old.fulfillment_status,old.boxed_at,old.shipment_id,old.admin_note) then
    insert into public.store_order_events(order_id,actor,payment_before,payment_after,fulfillment_before,fulfillment_after,boxed_at,shipment_id,note)
    values(new.id,auth.uid(),old.payment_status,new.payment_status,old.fulfillment_status,new.fulfillment_status,new.boxed_at,new.shipment_id,new.admin_note);
  end if;
  return new;
end; $$;
revoke all on function public.audit_store_order() from public,anon,authenticated;
create trigger store_order_audit after insert or update on public.store_orders for each row execute function public.audit_store_order();

create function public.claim_store_reconciliation(p_limit integer default 3)
returns setof public.store_orders language sql security definer set search_path='' as $$
  with candidates as (
    select id from public.store_orders where payment_status in('creating','pending')
      and (reconciliation_checked_at is null or reconciliation_checked_at<now()-interval '5 minutes')
    order by reconciliation_checked_at nulls first,created_at,id
    limit greatest(1,least(coalesce(p_limit,3),10)) for update skip locked
  ) update public.store_orders o set reconciliation_checked_at=now()
    from candidates c where o.id=c.id returning o.*;
$$;
revoke all on function public.claim_store_reconciliation(integer) from public,anon,authenticated;
grant execute on function public.claim_store_reconciliation(integer) to service_role;

-- O processamento original continua responsável por cancelamentos e devoluções.
alter function public.handle_store_order(uuid,text,text) rename to handle_store_order_base;
revoke all on function public.handle_store_order_base(uuid,text,text) from public,anon,authenticated;
create function public.handle_store_order(p_order_id uuid,p_status text,p_note text default null)
returns void language plpgsql security definer set search_path='' as $$
declare o public.store_orders%rowtype; physical boolean;
begin
  if not public.has_staff_write() then raise exception 'Acesso negado.'; end if;
  select * into o from public.store_orders where id=p_order_id for update;
  if not found or o.payment_status<>'paid' or o.fulfillment_status='fulfilled' then raise exception 'Somente pedidos pagos e não concluídos podem ser atendidos.'; end if;
  select exists(select 1 from public.store_order_items where order_id=o.id and delivery_kind='physical') into physical;
  if p_status='boxed' then
    if not physical or o.fulfillment_status<>'processing' then raise exception 'Inicie a separação antes de colocar na caixa.'; end if;
    if o.boxed_at is null then
      update public.store_orders set boxed_at=clock_timestamp(),admin_note=nullif(left(trim(p_note),500),''),handled_by=auth.uid(),updated_at=now() where id=o.id;
    end if;
    return;
  end if;
  if p_status='fulfilled' and physical then
    raise exception 'Produto físico: conclua pelo envio, após a entrega confirmada. Separe e coloque na caixa do cliente.';
  end if;
  if p_status='processing' and o.fulfillment_status='processing' then return; end if;
  if o.shipment_id is not null and p_status='cancelled' then raise exception 'Cancele a etiqueta antes de cancelar o pedido.'; end if;
  perform public.handle_store_order_base(p_order_id,p_status,p_note);
end; $$;
revoke all on function public.handle_store_order(uuid,text,text) from public,anon;
grant execute on function public.handle_store_order(uuid,text,text) to authenticated;

-- Reserva os pedidos prontos na mesma transação; cada pedido só pertence a um envio.
create function public.assert_store_shipping_ready(p_customer uuid,p_day date)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_day is null then raise exception 'Informe a data de envio.'; end if;
 if exists(select 1 from public.store_orders o where o.customer_id=p_customer and o.payment_status='paid'
   and o.fulfillment_status<>'fulfilled' and o.shipment_id is null and o.created_at<((p_day+1)::timestamp at time zone 'America/Sao_Paulo')
   and o.boxed_at is null and exists(select 1 from public.store_order_items i where i.order_id=o.id and i.delivery_kind='physical')) then
   raise exception 'Há produtos da loja pagos aguardando separação. Coloque-os na caixa antes de emitir.';
 end if;
end; $$;
revoke all on function public.assert_store_shipping_ready(uuid,date) from public,anon,authenticated;
grant execute on function public.assert_store_shipping_ready(uuid,date) to service_role;
create function public.bind_store_orders_to_shipment(p_shipment uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare s public.shipments%rowtype; n integer;
begin
  select * into s from public.shipments where id=p_shipment for update;
  if not found or s.status<>'pending' then raise exception 'Envio indisponível.'; end if;
  perform public.assert_customer_shipping_ready(s.customer_id);
  if not exists(select 1 from public.shipment_lots sl join public.lots l on l.id=sl.lot_id
    where sl.shipment_id=s.id and l.customer_id=s.customer_id and l.status='paid') then
    raise exception 'Vincule os lotes pagos e o frete do período antes de incluir compras da loja.';
  end if;
  -- Não deixar uma compra física paga para trás sem que a equipe a separe.
  perform public.assert_store_shipping_ready(s.customer_id,s.batch_date);
  update public.store_orders o set shipment_id=s.id,updated_at=now()
  where o.customer_id=s.customer_id and o.payment_status='paid' and o.fulfillment_status<>'fulfilled'
    and o.boxed_at is not null and o.shipment_id is null
    and o.created_at < ((s.batch_date+1)::timestamp at time zone 'America/Sao_Paulo')
    and exists(select 1 from public.store_order_items i where i.order_id=o.id and i.delivery_kind='physical');
  get diagnostics n=row_count;
  return n;
end; $$;
revoke all on function public.bind_store_orders_to_shipment(uuid) from public,anon,authenticated;
grant execute on function public.bind_store_orders_to_shipment(uuid) to service_role;

create function public.sync_store_shipment()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='cancelled' then
    update public.store_orders set shipment_id=null,updated_at=now() where shipment_id=new.id;
  elsif new.status='delivered' then
    update public.store_orders set fulfillment_status='fulfilled',updated_at=now()
      where shipment_id=new.id and payment_status='paid' and boxed_at is not null and fulfillment_status<>'fulfilled';
  end if;
  return new;
end; $$;
revoke all on function public.sync_store_shipment() from public,anon,authenticated;
create trigger store_shipment_status after update of status on public.shipments
for each row execute function public.sync_store_shipment();

-- Dados operacionais restritos à equipe; usados no relatório e na tela de pedidos.
create function public.get_store_fulfillment(p_customer uuid default null,p_day date default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'code',o.code,'customer_id',o.customer_id,
    'boxed_at',o.boxed_at,'shipment_id',o.shipment_id,'fulfillment_status',o.fulfillment_status,'reconciliation_error',o.reconciliation_error,
    'physical',exists(select 1 from public.store_order_items i where i.order_id=o.id and i.delivery_kind='physical'),
    'items',(select jsonb_agg(jsonb_build_object('name',i.name,'quantity',i.quantity,'delivery_kind',i.delivery_kind)) from public.store_order_items i where i.order_id=o.id)) order by o.created_at,o.id)
    from public.store_orders o where (p_customer is null or o.customer_id=p_customer)
      and (p_day is null or (o.payment_status='paid' and o.fulfillment_status<>'fulfilled' and o.shipment_id is null
        and o.created_at<((p_day+1)::timestamp at time zone 'America/Sao_Paulo')))), '[]'::jsonb);
end; $$;
revoke all on function public.get_store_fulfillment(uuid,date) from public,anon;
grant execute on function public.get_store_fulfillment(uuid,date) to authenticated;

-- Estorno de produto já postado não devolve estoque físico automaticamente.
create or replace function public.settle_store_payment(p_reference text,p_mp_order_id text,p_amount numeric,p_status text,p_paid_at timestamptz default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_order public.store_orders%rowtype;
begin
  if p_status not in ('paid','cancelled','expired','failed','refunded','partially_refunded') or p_mp_order_id is null then raise exception 'Status inválido.'; end if;
  select * into v_order from public.store_orders where external_reference = p_reference for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if p_amount is null or p_amount <> v_order.cash_total or v_order.cash_total <= 0
    or (v_order.mp_order_id is not null and v_order.mp_order_id <> p_mp_order_id) then raise exception 'Pagamento divergente.'; end if;
  if v_order.payment_status = p_status then return; end if;
  if p_status = 'partially_refunded' then
    if v_order.payment_status not in ('creating','pending','paid') then return; end if;
    update public.store_orders set payment_status = p_status,mp_order_id = p_mp_order_id,
      paid_at = coalesce(v_order.paid_at,p_paid_at,now()),updated_at = now() where id = v_order.id;
    return;
  end if;
  if p_status = 'paid' then
    if v_order.payment_status not in ('creating','pending') then
      if v_order.payment_status = 'partially_refunded' then return; end if;
      update public.store_orders set payment_status = 'payment_review',mp_order_id = p_mp_order_id,
        paid_at = coalesce(v_order.paid_at,p_paid_at,now()),updated_at = now() where id = v_order.id;
      return;
    end if;
    update public.store_orders set payment_status = 'paid',mp_order_id = p_mp_order_id,
      paid_at = coalesce(p_paid_at,now()),updated_at = now() where id = v_order.id;
    return;
  end if;
  if v_order.payment_status in ('cancelled','expired','failed','refunded') then return; end if;
  if v_order.payment_status in ('paid','partially_refunded','payment_review') and p_status <> 'refunded' then return; end if;
  if v_order.payment_status not in ('paid','partially_refunded','payment_review') and p_status = 'refunded' then p_status := 'failed'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_order.customer_id::text,0));
  if v_order.resources_released_at is null then
    if v_order.coins_total > 0 then
      insert into public.loyalty_ledger(customer_id,points,kind,store_order_id,note)
      values (v_order.customer_id,v_order.coins_total,'adjustment',v_order.id,'Caracoins devolvidas · pedido ' || v_order.code);
    end if;
    if v_order.fulfillment_status <> 'fulfilled' and not exists (select 1 from public.shipments s where s.id=v_order.shipment_id and s.status in ('posted','delivered')) then
      perform r.id from public.loyalty_rewards r join public.store_order_items i on i.reward_id = r.id
      where i.order_id = v_order.id order by r.id for update of r;
      update public.loyalty_rewards r set stock = r.stock + x.quantity from (
        select reward_id,sum(quantity)::integer as quantity from public.store_order_items
        where order_id = v_order.id and reserved_stock group by reward_id
      ) x where r.id = x.reward_id and r.stock is not null;
    end if;
  end if;
  update public.store_orders set payment_status = p_status,mp_order_id = p_mp_order_id,
    resources_released_at = now(),updated_at = now() where id = v_order.id;
end;
$$;
revoke all on function public.settle_store_payment(text,text,numeric,text,timestamptz) from public,anon,authenticated;
grant execute on function public.settle_store_payment(text,text,numeric,text,timestamptz) to service_role;


-- Enriquecimento somente da página solicitada: sem carregar todos os pedidos.
alter function public.get_admin_order_history(text,text,text,date,date,integer,integer) rename to get_admin_order_history_base;
revoke all on function public.get_admin_order_history_base(text,text,text,date,date,integer,integer) from public,anon,authenticated;
create function public.get_admin_order_history(
 p_query text default '',p_status text default 'all',p_source text default 'all',p_from date default null,p_to date default null,p_page integer default 1,p_size integer default 20
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.is_admin() then raise exception 'Acesso negado.'; end if;
 result:=public.get_admin_order_history_base(p_query,p_status,p_source,p_from,p_to,p_page,p_size);
 return jsonb_set(result,'{items}',coalesce((select jsonb_agg(item || case when item->>'source'='store' then
   (select jsonb_build_object('boxed_at',o.boxed_at,'shipment_id',o.shipment_id,'reconciliation_error',o.reconciliation_error,
     'physical',exists(select 1 from public.store_order_items i where i.order_id=o.id and i.delivery_kind='physical'),
     'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.happened_at desc,e.id desc)
       from(select id,happened_at,actor,payment_before,payment_after,fulfillment_before,fulfillment_after,boxed_at,shipment_id,note
         from public.store_order_events where order_id=o.id order by happened_at desc,id desc limit 10)e),'[]'::jsonb))
    from public.store_orders o where o.id=(item->>'id')::uuid) else '{}'::jsonb end order by ord)
   from jsonb_array_elements(result->'items') with ordinality as r(item,ord)),'[]'::jsonb));
end; $$;
revoke all on function public.get_admin_order_history(text,text,text,date,date,integer,integer) from public,anon;
grant execute on function public.get_admin_order_history(text,text,text,date,date,integer,integer) to authenticated;

alter function public.get_customer_order_history(text,date,date,integer) rename to get_customer_order_history_base;
revoke all on function public.get_customer_order_history_base(text,date,date,integer) from public,anon,authenticated;
create function public.get_customer_order_history(p_status text default 'all',p_from date default null,p_to date default null,p_page integer default 1)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; customer uuid:=public.current_customer_id();
begin
 if customer is null then raise exception 'Acesso negado.'; end if;
 result:=public.get_customer_order_history_base(p_status,p_from,p_to,p_page);
 return jsonb_set(result,'{items}',coalesce((select jsonb_agg(item || case when item->>'source'='store' then
  (select jsonb_build_object('boxed_at',o.boxed_at,'shipment_id',o.shipment_id,
    'shipment',(select jsonb_build_object('code',s.code,'status',s.status,'tracking_code',s.tracking_code) from public.shipments s where s.id=o.shipment_id and s.customer_id=customer))
    from public.store_orders o where o.id=(item->>'id')::uuid and o.customer_id=customer)
  else '{}'::jsonb end order by ord) from jsonb_array_elements(result->'items') with ordinality as r(item,ord)),'[]'::jsonb));
end; $$;
revoke all on function public.get_customer_order_history(text,date,date,integer) from public,anon;
grant execute on function public.get_customer_order_history(text,date,date,integer) to authenticated;

create or replace function public.get_customer_store_catalog(p_query text default '',p_category text default '',p_mode text default '',p_sort text default 'newest',p_page integer default 1)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
 if public.current_customer_id() is null then raise exception 'Acesso negado.'; end if;
 with filtered as materialized (
 select id,name,description,delivery_kind,points_cost,stock,image_path,image_paths,sku,category,cash_price,mixed_cash_price,mixed_points_cost,created_at
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
