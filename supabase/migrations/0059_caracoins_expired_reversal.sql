-- Evita cobrar novamente moedas expiradas ao cancelar um lote pago.
begin;
create or replace function public.guard_caracoins_expiry_0058() returns trigger
language plpgsql security definer set search_path='' as $$
declare balance numeric;expired_reversal numeric;
begin
 perform 1 from public.customers where id=new.customer_id for update;
 if new.points>0 then new.coins_expires_at:=now()+interval '90 days'; end if;
 if new.points<0 and new.coin_event is distinct from 'expiry' then
  perform public.expire_customer_caracoins(new.customer_id);
  if new.kind='reversal' and new.lot_id is not null and not exists(select 1 from public.loyalty_ledger where lot_id=new.lot_id and kind='reversal') then
   -- O estorno continua integral no ranking, mas moedas já expiradas não geram dívida duas vezes.
   with credits as (select points,lot_id,sum(points) over(order by created_at,id rows unbounded preceding) as finish
    from public.loyalty_ledger where customer_id=new.customer_id and points>0),
   debits as (select -points as amount,coin_event,sum(-points) over(order by created_at,id rows unbounded preceding) as finish
    from public.loyalty_ledger where customer_id=new.customer_id and points<0)
   select least(-new.points,coalesce(sum(greatest(0,least(c.finish,d.finish)-greatest(c.finish-c.points,d.finish-d.amount))),0))
    into expired_reversal from credits c cross join debits d where c.lot_id=new.lot_id and d.coin_event='expiry';
   if expired_reversal>0 then
    insert into public.loyalty_ledger(customer_id,points,kind,note)
     values(new.customer_id,expired_reversal,'adjustment','Compensação no estorno de moedas já expiradas; sem pontos de ranking.');
   end if;
  end if;
  if new.kind='spent' then
   select coalesce(sum(points),0) into balance from public.loyalty_ledger where customer_id=new.customer_id;
   if balance+new.points<0 then raise exception 'Saldo de Caracoins insuficiente ou expirado.';end if;
  end if;
 end if;
 return new;
end $$;
commit;
