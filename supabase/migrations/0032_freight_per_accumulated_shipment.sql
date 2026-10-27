-- Requer 0031. R$20 por pacote acumulado, independentemente das semanas.
-- Não altera cobranças já criadas no Mercado Pago nem reembolsa pagamentos antigos.
begin;

create table public.shipment_freight_usage(
  charge_id uuid primary key references public.charges(id) on delete restrict,
  shipment_id uuid not null unique references public.shipments(id) on delete restrict,
  customer_id uuid not null references public.customers(id),
  created_at timestamptz not null default now()
);
alter table public.shipment_freight_usage enable row level security;
revoke all on public.shipment_freight_usage from public,anon,authenticated;
grant all on public.shipment_freight_usage to service_role;
create index shipment_freight_customer on public.shipment_freight_usage(customer_id);

-- Reconhece fretes já usados pelos pacotes existentes. Não cria novos débitos.
insert into public.shipment_freight_usage(charge_id,shipment_id,customer_id)
 select charge_id,shipment_id,customer_id from (
  select distinct on(s.id) c.id charge_id,s.id shipment_id,s.customer_id
  from public.shipments s join public.shipment_lots sl on sl.shipment_id=s.id
  join public.lots l on l.id=sl.lot_id join public.charges c on c.customer_id=s.customer_id
    and (c.id=l.charge_id or exists(select 1 from public.charge_freight_items f where f.charge_id=c.id
      and (f.first_lot_id=l.id or f.freight_period=l.auction_date-((extract(dow from l.auction_date)::integer-2+7)%7))))
  where s.status<>'cancelled' and c.status='approved' and c.freight_amount>0 and c.customer_id=s.customer_id
  order by s.id,c.paid_at desc nulls last,c.id
 ) old_usage on conflict do nothing;

-- É permitido pagar outro pacote na mesma semana, depois de usar o frete anterior.
drop index public.charge_freight_once;
drop index if exists public.charges_freight_period_uidx;
create unique index charges_one_pending_freight on public.charges(customer_id,freight_period)
 where freight_amount>0 and status in('pending','in_process');
create unique index charge_freight_one_pending on public.charge_freight_items(customer_id,freight_period)
 where status in('pending','in_process');

create function public.available_shipment_freight(p_customer uuid)
returns table(charge_id uuid) language sql stable security definer set search_path='' as $$
 select c.id from public.charges c where c.customer_id=p_customer and c.status='approved' and c.freight_amount>0
 and not exists(select 1 from public.shipment_freight_usage u join public.shipments s on s.id=u.shipment_id
   where u.charge_id=c.id and s.status<>'cancelled')
 order by c.paid_at nulls last,c.created_at,c.id;
$$;
revoke all on function public.available_shipment_freight(uuid) from public,anon,authenticated;
grant execute on function public.available_shipment_freight(uuid) to service_role;

create or replace function public.get_due_freight_periods(p_customer uuid)
returns table(freight_period date,first_lot_id uuid,freight_amount numeric)
language sql stable security definer set search_path='' as $$
 select l.auction_date-((extract(dow from l.auction_date)::integer-2+7)%7),l.id,20::numeric
 from public.lots l where l.customer_id=p_customer and l.status in('pending_payment','paid')
 and not exists(select 1 from public.shipment_lots sl join public.shipments s on s.id=sl.shipment_id where sl.lot_id=l.id and s.status<>'cancelled')
 and not exists(select 1 from public.available_shipment_freight(p_customer))
 and not exists(select 1 from public.charges c where c.customer_id=p_customer and c.freight_amount>0 and c.status in('pending','in_process'))
 order by l.created_at,l.id limit 1;
$$;

create or replace function public.reserve_charge_freights(p_charge uuid,p_lots uuid[])
returns numeric language plpgsql security definer set search_path='' as $$
declare c public.charges%rowtype;f record;total numeric:=0;
begin
 select * into c from public.charges where id=p_charge for update;
 if not found or c.status<>'pending' then raise exception 'Cobrança indisponível.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(c.customer_id::text,0));
 if exists(select 1 from public.charge_freight_items where charge_id=c.id) then
  return (select sum(freight_amount) from public.charge_freight_items where charge_id=c.id);
 end if;
 if exists(select 1 from public.lots where id=any(p_lots) and(customer_id<>c.customer_id or status<>'pending_payment')) then raise exception 'Revise os lotes do cliente.'; end if;
 for f in select * from public.get_due_freight_periods(c.customer_id) loop
  if exists(select 1 from public.lots where id=f.first_lot_id and status='pending_payment') and not(f.first_lot_id=any(p_lots)) then
   raise exception 'Inclua todos os lotes pendentes no pagamento acumulado.';
  end if;
  insert into public.charge_freight_items(charge_id,customer_id,freight_period,freight_amount,first_lot_id,status)
   values(c.id,c.customer_id,f.freight_period,20,f.first_lot_id,c.status);
  total:=20;
 end loop;
 update public.charges set freight_amount=total,
 freight_period=(select min(freight_period) from public.charge_freight_items where charge_id=c.id),
 amount=coalesce((select sum(arremate_value) from public.lots where id=any(p_lots)),0)+total where id=c.id;
 return total;
end; $$;

create or replace function public.require_lot_period_freight()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.charge_id is null or new.charge_id is not distinct from old.charge_id then return new; end if;
 if not exists(select 1 from public.available_shipment_freight(new.customer_id)) and not exists(
  select 1 from public.charge_freight_items f where f.customer_id=new.customer_id and f.charge_id=new.charge_id and f.status in('pending','in_process','approved')) then
  raise exception 'O frete de R$20 do envio acumulado deve acompanhar o pagamento dos lotes.';
 end if;
 return new;
end; $$;

create or replace function public.get_customer_freight_summary()
returns jsonb language plpgsql security definer set search_path='' as $$
declare customer uuid:=public.current_customer_id();code text;amount numeric;period date;
begin
 if customer is null then raise exception 'Acesso negado.'; end if;
 period:=(now() at time zone 'America/Sao_Paulo')::date;
 period:=period-((extract(dow from period)::integer-2+7)%7);
 select c.code,c.freight_amount into code,amount from public.charges c where c.customer_id=customer and c.freight_amount>0
   and c.status in('pending','in_process') order by c.created_at desc limit 1;
 if code is not null then return jsonb_build_object('status','awaiting','amount',amount,'periodStart',period,'chargeCode',code); end if;
 if exists(select 1 from public.available_shipment_freight(customer)) then return jsonb_build_object('status','paid','amount',20,'periodStart',period); end if;
 if exists(select 1 from public.get_due_freight_periods(customer)) then return jsonb_build_object('status','due','amount',20,'periodStart',period); end if;
 return jsonb_build_object('status','none','amount',20,'periodStart',period);
end; $$;

create function public.claim_shipment_freight(p_shipment uuid)
returns void language plpgsql security definer set search_path='' as $$
declare s public.shipments%rowtype;credit uuid;
begin
 select * into s from public.shipments where id=p_shipment for update;
 if not found or s.status<>'pending' then raise exception 'Envio indisponível.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s.customer_id::text,0));
 if exists(select 1 from public.shipment_freight_usage u join public.charges c on c.id=u.charge_id where u.shipment_id=s.id and c.status='approved') then return; end if;
 select f.charge_id into credit from public.available_shipment_freight(s.customer_id) f limit 1;
 if credit is null then raise exception 'O frete de R$20 deste envio ainda não foi pago.'; end if;
 perform 1 from public.charges where id=credit and status='approved' for update;
 if not found then raise exception 'O pagamento do frete mudou. Atualize antes de emitir.'; end if;
 insert into public.shipment_freight_usage(charge_id,shipment_id,customer_id) values(credit,s.id,s.customer_id)
 on conflict(charge_id) do update set shipment_id=excluded.shipment_id,created_at=now()
 where exists(select 1 from public.shipments old where old.id=shipment_freight_usage.shipment_id and old.status='cancelled');
 if not found then raise exception 'O frete já foi utilizado em outro envio.'; end if;
end; $$;
revoke all on function public.claim_shipment_freight(uuid) from public,anon,authenticated;
grant execute on function public.claim_shipment_freight(uuid) to service_role;

alter function public.bind_store_orders_to_shipment(uuid) rename to bind_store_orders_to_shipment_base;
revoke all on function public.bind_store_orders_to_shipment_base(uuid) from public,anon,authenticated,service_role;
create function public.bind_store_orders_to_shipment(p_shipment uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 n:=public.bind_store_orders_to_shipment_base(p_shipment);
 perform public.claim_shipment_freight(p_shipment);
 return n;
end; $$;
revoke all on function public.bind_store_orders_to_shipment(uuid) from public,anon,authenticated;
grant execute on function public.bind_store_orders_to_shipment(uuid) to service_role;

create function public.assert_shipment_freight(p_shipment uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.shipment_freight_usage u join public.charges c on c.id=u.charge_id
  where u.shipment_id=p_shipment and c.status='approved' and c.freight_amount>0) then raise exception 'Confira o pagamento do frete antes de pagar esta etiqueta.'; end if;
end; $$;
revoke all on function public.assert_shipment_freight(uuid) from public,anon,authenticated;
grant execute on function public.assert_shipment_freight(uuid) to service_role;

create function public.shipping_freight_states(p_customers uuid[])
returns table(customer_id uuid,status text) language sql stable security definer set search_path='' as $$
 select customer,case
  when exists(select 1 from public.available_shipment_freight(customer)) then 'paid'
  when exists(select 1 from public.charges c where c.customer_id=customer and c.freight_amount>0 and c.status in('pending','in_process')) then 'awaiting'
  when exists(select 1 from public.get_due_freight_periods(customer)) then 'due'
  when exists(select 1 from public.shipment_freight_usage u join public.shipments s on s.id=u.shipment_id join public.charges c on c.id=u.charge_id
    where u.customer_id=customer and s.status in('pending','released') and c.status='approved') then 'paid'
  else 'none' end
 from unnest(p_customers) customer;
$$;
revoke all on function public.shipping_freight_states(uuid[]) from public,anon,authenticated;
grant execute on function public.shipping_freight_states(uuid[]) to service_role;

commit;
