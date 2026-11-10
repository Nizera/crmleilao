-- Compatibilidade para quem já executou a 0074 anterior. Não reconta o histórico.
begin;
create or replace function public.warn_expired_customer_lot() returns trigger language plpgsql security definer set search_path='' as $$
declare auction_day date;
begin
 if new.status='cancelled' and new.payment_expired_at is not null and old.payment_expired_at is distinct from new.payment_expired_at then
  auction_day:=coalesce(new.auction_date,(new.created_at at time zone 'America/Sao_Paulo')::date);
  perform public.record_customer_warning(new.customer_id,'expired-auction-day:'||new.customer_id::text||':'||auction_day::text,
   'Lotes do leilão de '||to_char(auction_day,'DD/MM/YYYY')||' cancelados por falta de pagamento após 24 horas. Uma advertência por dia de leilão.');
 end if;
 return new;
end $$;
revoke all on function public.warn_expired_customer_lot() from public,anon,authenticated;
commit;
