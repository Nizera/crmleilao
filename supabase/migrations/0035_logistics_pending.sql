-- Reposições por erro logístico são independentes de arremates e pagamentos.
begin;

create table public.logistics_pending (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('PEN-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),
  customer_id uuid not null references public.customers(id),
  title text not null check (length(btrim(title)) between 1 and 160),
  quantity integer not null default 1 check (quantity between 1 and 999),
  reason text not null check (length(btrim(reason)) between 1 and 2000),
  shipping_date date not null,
  moved_at timestamptz,
  moved_by uuid references public.admin_profiles(id),
  shipment_id uuid references public.shipments(id),
  cancelled_at timestamptz,
  cancelled_by uuid references public.admin_profiles(id),
  created_by uuid not null references public.admin_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cancelled_at is null or shipment_id is null)
);
create index logistics_pending_queue_idx on public.logistics_pending(customer_id,shipping_date) where cancelled_at is null and shipment_id is null;
create index logistics_pending_list_idx on public.logistics_pending(shipping_date,created_at desc,id);
create index logistics_pending_shipment_idx on public.logistics_pending(shipment_id) where shipment_id is not null;
alter table public.logistics_pending enable row level security;
revoke all on public.logistics_pending from public,anon,authenticated;
grant select on public.logistics_pending to authenticated;
grant all on public.logistics_pending to service_role;
create policy logistics_pending_staff_read on public.logistics_pending for select to authenticated using (public.is_admin());
create trigger logistics_pending_updated before update on public.logistics_pending for each row execute function public.set_updated_at();

create view public.logistics_pending_list with (security_invoker=true) as
select p.*, c.name customer_name,c.phone_e164,
 s.code shipment_code,s.tracking_code,s.status shipment_status,
 case when p.cancelled_at is not null then 'cancelled'
 when s.status='delivered' then 'delivered'
 when s.status='posted' then 'shipped'
 when s.id is not null and s.status<>'cancelled' then 'shipping'
 when p.moved_at is not null then 'boxed' else 'open' end state
from public.logistics_pending p join public.customers c on c.id=p.customer_id
left join public.shipments s on s.id=p.shipment_id;
revoke all on public.logistics_pending_list from public,anon,authenticated;
grant select on public.logistics_pending_list to authenticated,service_role;

create function public.create_logistics_pending(p_customer uuid,p_title text,p_quantity integer,p_reason text,p_day date)
returns uuid language plpgsql security definer set search_path='' as $$
declare issue uuid;
begin
 if not public.has_staff_write() then raise exception 'Acesso negado.' using errcode='42501'; end if;
 if p_customer is null or p_day is null or p_title is null or p_reason is null or p_quantity is null then raise exception 'Preencha os dados da pendência.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_customer::text,0));
 insert into public.logistics_pending(customer_id,title,quantity,reason,shipping_date,created_by)
 values(p_customer,btrim(p_title),p_quantity,btrim(p_reason),p_day,auth.uid()) returning id into issue;
 return issue;
end; $$;
revoke all on function public.create_logistics_pending(uuid,text,integer,text,date) from public,anon;
grant execute on function public.create_logistics_pending(uuid,text,integer,text,date) to authenticated;

create function public.handle_logistics_pending(p_id uuid,p_action text,p_day date default null)
returns void language plpgsql security definer set search_path='' as $$
declare issue public.logistics_pending%rowtype; customer uuid;
begin
 if not public.has_staff_write() then raise exception 'Acesso negado.' using errcode='42501'; end if;
 select customer_id into customer from public.logistics_pending where id=p_id;
 if not found then raise exception 'Pendência não encontrada.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(customer::text,0));
 select * into issue from public.logistics_pending where id=p_id for update;
 if issue.shipment_id is not null then raise exception 'A pendência já está vinculada a uma etiqueta. Cancele a etiqueta antes de alterar.'; end if;
 if issue.cancelled_at is not null then raise exception 'Esta pendência foi cancelada.'; end if;
 if p_action='box' then
   if issue.moved_at is not null then return; end if;
   update public.logistics_pending set moved_at=now(),moved_by=auth.uid() where id=issue.id;
 elsif p_action='reopen' then
   update public.logistics_pending set moved_at=null,moved_by=null where id=issue.id;
 elsif p_action='cancel' then
   update public.logistics_pending set cancelled_at=now(),cancelled_by=auth.uid() where id=issue.id;
 elsif p_action='reschedule' and p_day is not null then
   update public.logistics_pending set shipping_date=p_day where id=issue.id;
 else raise exception 'Ação inválida.'; end if;
end; $$;
revoke all on function public.handle_logistics_pending(uuid,text,date) from public,anon;
grant execute on function public.handle_logistics_pending(uuid,text,date) to authenticated;

-- Usa o mesmo vínculo atômico já existente para loja/frete. Uma reposição
-- só segue no pacote após conferência física; não cria cobrança ou crédito.
alter function public.bind_store_orders_to_shipment(uuid) rename to bind_store_orders_before_logistics;
revoke all on function public.bind_store_orders_before_logistics(uuid) from public,anon,authenticated,service_role;
create function public.bind_store_orders_to_shipment(p_shipment uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare s public.shipments%rowtype; n integer;
begin
 select * into s from public.shipments where id=p_shipment for update;
 if not found or s.status<>'pending' then raise exception 'Envio indisponível.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s.customer_id::text,0));
 perform 1 from public.logistics_pending where customer_id=s.customer_id and shipping_date<=s.batch_date
   and cancelled_at is null and shipment_id is null order by id for update;
 if exists(select 1 from public.logistics_pending where customer_id=s.customer_id and shipping_date<=s.batch_date
   and cancelled_at is null and shipment_id is null and moved_at is null) then
   raise exception 'Separe as pendências logísticas deste cliente antes de emitir a etiqueta.';
 end if;
 n:=public.bind_store_orders_before_logistics(p_shipment);
 update public.logistics_pending set shipment_id=s.id where customer_id=s.customer_id and shipping_date<=s.batch_date
   and cancelled_at is null and shipment_id is null and moved_at is not null;
 return n;
end; $$;
revoke all on function public.bind_store_orders_to_shipment(uuid) from public,anon,authenticated;
grant execute on function public.bind_store_orders_to_shipment(uuid) to service_role;

create function public.release_logistics_on_cancel()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='cancelled' and old.status is distinct from new.status then
   update public.logistics_pending set shipment_id=null where shipment_id=new.id;
 end if;
 return new;
end; $$;
revoke all on function public.release_logistics_on_cancel() from public,anon,authenticated;
create trigger shipments_release_logistics after update of status on public.shipments
for each row execute function public.release_logistics_on_cancel();

commit;
