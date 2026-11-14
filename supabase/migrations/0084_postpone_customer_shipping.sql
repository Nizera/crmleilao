-- Adia apenas itens sem etiqueta, na data escolhida. Não altera pagamentos ou prazos.
begin;
create table if not exists public.shipping_postponements (
 id bigint generated always as identity primary key,
 customer_id uuid not null references public.customers(id),
 from_day date not null, to_day date not null,
 lot_ids uuid[] not null, logistics_ids uuid[] not null,
 created_by uuid not null, created_at timestamptz not null default now()
);
alter table public.shipping_postponements enable row level security;
revoke all on public.shipping_postponements from public,anon,authenticated;
create or replace function public.postpone_customer_shipping(
 p_customer uuid,p_from date,p_to date,p_logistics boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare lot_ids uuid[]; issue_ids uuid[];
begin
 if public.has_staff_write() is not true then raise exception 'Acesso negado.' using errcode='42501'; end if;
 if p_customer is null or p_from is null or p_to is null or p_to<=p_from
 or p_to<(now() at time zone 'America/Sao_Paulo')::date or p_logistics is null then
 raise exception 'Escolha uma nova data futura, posterior ao envio original.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_customer::text,0));
 if not exists(select 1 from public.customers where id=p_customer) then raise exception 'Cliente não encontrado.'; end if;
 -- Mesma trava usada na emissão e no vínculo do conteúdo do pacote.
 with changed as (
 update public.lots l set shipping_date=p_to
 where l.customer_id=p_customer and l.shipping_date=p_from and l.status in ('paid','pending_payment')
 and not exists(select 1 from public.shipment_lots sl join public.shipments s on s.id=sl.shipment_id
 where sl.lot_id=l.id and s.status<>'cancelled') returning l.id
 ) select coalesce(array_agg(id),'{}'::uuid[]) into lot_ids from changed;
 issue_ids:='{}'::uuid[];
 if p_logistics then
 with changed as (
 update public.logistics_pending p set shipping_date=p_to
 where p.customer_id=p_customer and p.shipping_date=p_from and p.cancelled_at is null
 and p.shipment_id is null returning p.id
 ) select coalesce(array_agg(id),'{}'::uuid[]) into issue_ids from changed;
 end if;
 if cardinality(lot_ids)+cardinality(issue_ids)=0 then raise exception 'Nenhum item disponível nesta data. Itens com etiqueta não podem ser adiados.'; end if;
 insert into public.shipping_postponements(customer_id,from_day,to_day,lot_ids,logistics_ids,created_by)
 values(p_customer,p_from,p_to,lot_ids,issue_ids,auth.uid());
 return jsonb_build_object('lots',cardinality(lot_ids),'logistics',cardinality(issue_ids));
end; $$;
revoke all on function public.postpone_customer_shipping(uuid,date,date,boolean) from public,anon;
grant execute on function public.postpone_customer_shipping(uuid,date,date,boolean) to authenticated;
commit;
