-- Frete obrigatório por ciclo, vinculado ao primeiro lote e incluído no Pix.
begin;
create table public.charge_freight_items(
 charge_id uuid not null references public.charges(id) on delete cascade,
 customer_id uuid not null references public.customers(id),
 freight_period date not null, freight_amount numeric(10,2) not null check(freight_amount>0),
 first_lot_id uuid references public.lots(id) on delete set null,status text not null,
 primary key(charge_id,freight_period)
);
alter table public.charge_freight_items enable row level security;
revoke all on public.charge_freight_items from public,anon,authenticated;
grant all on public.charge_freight_items to service_role;
create unique index charge_freight_once on public.charge_freight_items(customer_id,freight_period)
 where status in ('pending','in_process','approved');
insert into public.charge_freight_items(charge_id,customer_id,freight_period,freight_amount,status)
 select id,customer_id,freight_period,freight_amount,status from public.charges where freight_amount>0 and freight_period is not null;
create view public.charge_freight_periods as
 select f.charge_id as id,f.customer_id,f.freight_period,f.freight_amount,c.code,c.status,c.expires_at,c.paid_at,c.created_at
 from public.charge_freight_items f join public.charges c on c.id=f.charge_id;
revoke all on public.charge_freight_periods from public,anon,authenticated;
grant select on public.charge_freight_periods to service_role;
create function public.sync_charge_freight_items() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' and new.freight_amount>0 and new.freight_period is not null then
  insert into public.charge_freight_items(charge_id,customer_id,freight_period,freight_amount,status)
  values(new.id,new.customer_id,new.freight_period,new.freight_amount,new.status);
 elsif tg_op='UPDATE' then update public.charge_freight_items set status=new.status where charge_id=new.id; end if;
 return new;
end; $$;
revoke all on function public.sync_charge_freight_items() from public,anon,authenticated;
create trigger sync_charge_freights_insert after insert on public.charges for each row execute function public.sync_charge_freight_items();
create trigger sync_charge_freights_status after update of status on public.charges for each row execute function public.sync_charge_freight_items();

create function public.get_due_freight_periods(p_customer uuid)
returns table(freight_period date,first_lot_id uuid,freight_amount numeric) language sql stable security definer set search_path='' as $$
 with lots as (
 select l.id,l.created_at,l.auction_date-((extract(dow from l.auction_date)::integer-2+7)%7) as period
 from public.lots l where l.customer_id=p_customer and l.status in('pending_payment','paid')
 ), firsts as (select distinct on(period) period,id from lots order by period,created_at,id)
 select f.period,f.id,20::numeric from firsts f where not exists(select 1 from public.charge_freight_items c
 where c.customer_id=p_customer and c.freight_period=f.period and c.status in ('pending','in_process','approved'))
 order by f.period;
$$;
revoke all on function public.get_due_freight_periods(uuid) from public,anon,authenticated;
grant execute on function public.get_due_freight_periods(uuid) to service_role;

create function public.reserve_charge_freights(p_charge uuid,p_lots uuid[])
returns numeric language plpgsql security definer set search_path='' as $$
declare c public.charges%rowtype; f record; total numeric:=0;
begin
 select * into c from public.charges where id=p_charge for update;
 if not found or c.status<>'pending' then raise exception 'Cobrança indisponível.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(c.customer_id::text,0));
 if exists(select 1 from public.charge_freight_items where charge_id=c.id) then
  return (select sum(freight_amount) from public.charge_freight_items where charge_id=c.id);
 end if;
 if exists(select 1 from public.lots where id=any(p_lots) and(customer_id<>c.customer_id or status<>'pending_payment')) then raise exception 'Revise os lotes do cliente.'; end if;
 for f in select * from public.get_due_freight_periods(c.customer_id) loop
  if exists(select 1 from public.lots where id=f.first_lot_id and status='pending_payment')
   and not(f.first_lot_id=any(p_lots)) then raise exception 'Inclua o primeiro lote de cada ciclo para pagar o frete junto.'; end if;
  insert into public.charge_freight_items(charge_id,customer_id,freight_period,freight_amount,first_lot_id,status)
  values(c.id,c.customer_id,f.freight_period,f.freight_amount,f.first_lot_id,c.status);
  total:=total+f.freight_amount;
 end loop;
 update public.charges set freight_amount=total,freight_period=(select min(freight_period) from public.charge_freight_items where charge_id=c.id),
 amount=coalesce((select sum(arremate_value) from public.lots where id=any(p_lots)),0)+total where id=c.id;
 return total;
end; $$;
revoke all on function public.reserve_charge_freights(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.reserve_charge_freights(uuid,uuid[]) to service_role;

create function public.require_lot_period_freight() returns trigger language plpgsql security definer set search_path='' as $$
declare period date;
begin
 if new.charge_id is null or new.charge_id is not distinct from old.charge_id then return new; end if;
 period:=new.auction_date-((extract(dow from new.auction_date)::integer-2+7)%7);
 if not exists(select 1 from public.charge_freight_items f where f.customer_id=new.customer_id and f.freight_period=period
 and(f.status='approved' or(f.charge_id=new.charge_id and f.status in('pending','in_process')))) then
 raise exception 'O frete do ciclo deve ser incluído no Pix dos lotes.'; end if;
 return new;
end; $$;
revoke all on function public.require_lot_period_freight() from public,anon,authenticated;
create trigger require_lot_period_freight before update of charge_id on public.lots for each row execute function public.require_lot_period_freight();

create function public.get_customer_freight_summary()
returns jsonb language plpgsql security definer set search_path='' as $$
declare customer uuid:=public.current_customer_id(); due numeric; current_period date; active_code text; has_paid boolean;
begin
 if customer is null then raise exception 'Acesso negado.'; end if;
 current_period:=(now() at time zone 'America/Sao_Paulo')::date;
 current_period:=current_period-((extract(dow from current_period)::integer-2+7)%7);
 select sum(freight_amount) into due from public.get_due_freight_periods(customer);
 select c.code into active_code from public.charge_freight_items f join public.charges c on c.id=f.charge_id
 where f.customer_id=customer and f.status in('pending','in_process') order by c.created_at desc limit 1;
 select exists(select 1 from public.charge_freight_items where customer_id=customer and freight_period=current_period and status='approved') into has_paid;
 return jsonb_build_object('status',case when active_code is not null then 'awaiting' when coalesce(due,0)>0 then 'due' when has_paid then 'paid' else 'none' end,
 'amount',coalesce(due,20),'periodStart',current_period,'chargeCode',active_code);
end; $$;
revoke all on function public.get_customer_freight_summary() from public,anon;
grant execute on function public.get_customer_freight_summary() to authenticated;
create function public.assert_customer_shipping_ready(p_customer uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.lots where customer_id=p_customer and status='pending_payment') then
  raise exception 'Não é possível emitir: há lotes pendentes de pagamento.'; end if;
 if exists(select 1 from public.charges where customer_id=p_customer and status in('pending','in_process')) then
  raise exception 'Não é possível emitir: há um Pix pendente. Verifique ou cancele antes de emitir.'; end if;
 if exists(select 1 from public.get_due_freight_periods(p_customer)) then
  raise exception 'Não é possível emitir: há frete de período pendente.'; end if;
end; $$;
revoke all on function public.assert_customer_shipping_ready(uuid) from public,anon,authenticated;
grant execute on function public.assert_customer_shipping_ready(uuid) to service_role;

create function public.get_customer_pending_payment_total(p_customer uuid)
returns numeric language sql stable security definer set search_path='' as $$
 select coalesce((select sum(arremate_value) from public.lots where customer_id=p_customer and status='pending_payment'),0)
 +coalesce((select sum(freight_amount) from public.get_due_freight_periods(p_customer)),0)
 +coalesce((select sum(freight_amount) from public.charge_freight_items where customer_id=p_customer and status in('pending','in_process')),0);
$$;
revoke all on function public.get_customer_pending_payment_total(uuid) from public,anon,authenticated;
grant execute on function public.get_customer_pending_payment_total(uuid) to service_role;
commit;

