-- Custo da etiqueta SuperFrete; independente do frete cobrado do cliente.
begin;
alter table public.shipments
  add column if not exists original_price numeric(10,2),
  add column if not exists price_baseline_legacy boolean not null default false,
  add column if not exists price_change_count integer not null default 0,
  add column if not exists price_changed_at timestamptz,
  add column if not exists price_checked_at timestamptz,
  add column if not exists price_observation_source text,
  add column if not exists price_difference numeric(10,2)
    generated always as (price - original_price) stored;

-- Não inventar o preço de emissão de etiquetas anteriores à implantação.
update public.shipments set original_price=price, price_baseline_legacy=true
where original_price is null and price is not null;

create table if not exists public.shipment_price_history (
  id bigint generated always as identity primary key,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  previous_price numeric(10,2) not null,
  current_price numeric(10,2) not null,
  observed_at timestamptz not null default now(),
  source text not null check(source in ('api','webhook','record')),
  check(previous_price <> current_price)
);
create index if not exists shipment_price_history_shipment_idx
  on public.shipment_price_history(shipment_id, observed_at desc, id desc);
create index if not exists shipments_price_changed_idx
  on public.shipments(price_changed_at desc) where price_change_count>0;
alter table public.shipment_price_history enable row level security;
revoke all on public.shipment_price_history from anon, authenticated;
grant select on public.shipment_price_history to authenticated;
grant all on public.shipment_price_history to service_role;
grant usage, select on sequence public.shipment_price_history_id_seq to service_role;
drop policy if exists shipment_price_history_admin_read on public.shipment_price_history;
create policy shipment_price_history_admin_read on public.shipment_price_history
  for select to authenticated using(public.is_admin());

create or replace function public.record_shipment_price_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    new.original_price:=new.price;
    new.price_baseline_legacy:=false;
    new.price_change_count:=0;
    new.price_changed_at:=null;
    return new;
  end if;
  new.original_price:=old.original_price;
  new.price_baseline_legacy:=old.price_baseline_legacy;
  new.price_change_count:=old.price_change_count;
  new.price_changed_at:=old.price_changed_at;
  if new.price is distinct from old.price then
    if old.price is not null and new.price is not null then
      insert into public.shipment_price_history(shipment_id,previous_price,current_price,source)
      values(old.id,old.price,new.price,case when new.price_observation_source in ('api','webhook') then new.price_observation_source else 'record' end);
      new.price_change_count:=old.price_change_count+1;
      new.price_changed_at:=now();
    end if;
    if new.original_price is null and new.price is not null then
      new.original_price:=new.price;
      new.price_baseline_legacy:=true;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.record_shipment_price_change() from public,anon,authenticated;
drop trigger if exists shipments_record_price on public.shipments;
create trigger shipments_record_price before insert or update on public.shipments
for each row execute function public.record_shipment_price_change();

-- Agrega o conjunto completo filtrado, nunca apenas a página visível.
create or replace function public.get_shipment_cost_summary(
  p_day date default null, p_query text default '', p_status text default 'all', p_cost text default 'all'
) returns jsonb language sql stable security invoker set search_path='' as $$
  with filtered as (
    select s.* from public.shipments s left join public.customers c on c.id=s.customer_id
    where public.is_admin()
      and (p_day is null or s.batch_date=p_day)
      and (p_status='all' or s.status::text=p_status)
      and (p_cost='all' or (s.price_change_count>0 and (
        p_cost='changed' or (p_cost='increase' and s.price_difference>0) or (p_cost='decrease' and s.price_difference<0))))
      and (length(trim(p_query))<2 or
        strpos(lower(s.code),lower(trim(p_query)))>0 or
        strpos(lower(s.sf_order_id),lower(trim(p_query)))>0 or
        strpos(lower(coalesce(s.tracking_code,'')),lower(trim(p_query)))>0 or
        strpos(lower(coalesce(c.name,'')),lower(trim(p_query)))>0 or
        (length(regexp_replace(p_query,'[^0-9]','','g'))>=4 and
          strpos(c.phone_e164,regexp_replace(p_query,'[^0-9]','','g'))>0))
  ) select jsonb_build_object(
    'labels', count(*) filter(where status::text<>'cancelled'),
    'cancelled', count(*) filter(where status::text='cancelled'),
    'emissionTotal', coalesce(sum(coalesce(original_price,price)) filter(where status::text<>'cancelled'),0),
    'unknownPrices', count(*) filter(where status::text<>'cancelled' and coalesce(original_price,price) is null),
    'legacyPrices', count(*) filter(where status::text<>'cancelled' and price_baseline_legacy)
  ) from filtered;
$$;
revoke all on function public.get_shipment_cost_summary(date,text,text,text) from public,anon;
grant execute on function public.get_shipment_cost_summary(date,text,text,text) to authenticated,service_role;
commit;
