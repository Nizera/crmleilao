-- Reservas novas duram dez minutos. Reservas antigas recebem dez minutos de transição.
-- Somente a confirmação do provedor, via settle_raffle_payment, libera as cotas.
begin;
alter table public.raffle_orders add column reservation_expires_at timestamptz not null default (now()+interval '10 minutes');
create index raffle_orders_reservation_deadline on public.raffle_orders(reservation_expires_at,checked_at)
 where status in ('creating','pending');

create function public.normalize_raffle_timeout() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='cancelled' and new.reservation_expires_at<=now() then new.status:='expired'; end if;
 return new;
end; $$;
revoke all on function public.normalize_raffle_timeout() from public,anon,authenticated;
create trigger raffle_normalize_timeout before update of status on public.raffle_orders
for each row execute function public.normalize_raffle_timeout();

create or replace function public.claim_raffle_reconciliation() returns setof public.raffle_orders
language sql security definer set search_path='' as $$
 with candidates as (
  select id from public.raffle_orders where status in ('creating','pending')
  and (checked_at is null or checked_at<now()-interval '45 seconds')
  order by (reservation_expires_at<=now()) desc,checked_at nulls first,reservation_expires_at,id
  limit 3 for update skip locked
 ) update public.raffle_orders o set checked_at=now() from candidates c where c.id=o.id returning o.*;
$$;
commit;
