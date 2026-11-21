-- Paid raffle purchases follow auction tier rates. Historical credit is run separately.
begin;
alter table public.loyalty_ledger add column raffle_order_id uuid references public.raffle_orders(id) on delete restrict;
create unique index raffle_ledger_once on public.loyalty_ledger(raffle_order_id,kind) where raffle_order_id is not null;
alter table public.loyalty_ledger drop constraint loyalty_ledger_source_check;
alter table public.loyalty_ledger add constraint loyalty_ledger_source_check check(
 (kind='earned' and points>0 and num_nonnulls(lot_id,raffle_order_id)=1 and num_nonnulls(redemption_id,store_order_id,voucher_id)=0)
 or(kind='spent' and points<0 and lot_id is null and raffle_order_id is null and num_nonnulls(redemption_id,store_order_id,voucher_id)=1)
 or(kind='reversal' and num_nonnulls(lot_id,raffle_order_id)=1 and num_nonnulls(redemption_id,store_order_id,voucher_id)=0 and (raffle_order_id is null or points<0))
 or(kind='adjustment' and lot_id is null and raffle_order_id is null and redemption_id is null and voucher_id is null)
);

create function public.credit_paid_raffle_caracoins(p_order uuid) returns numeric
language plpgsql security definer set search_path='' as $$
declare o public.raffle_orders%rowtype;rank_before numeric;rate numeric;coins numeric;campaign_title text;
begin
 select * into o from public.raffle_orders where id=p_order for update;
 if not found or o.status<>'paid' or o.amount<=0 or not exists(select 1 from public.loyalty_settings where id and active) then return 0;end if;
 perform 1 from public.customers where id=o.customer_id for update;
 if exists(select 1 from public.loyalty_ledger where raffle_order_id=o.id and kind='earned') then return 0;end if;
 select coalesce(sum(points),0) into rank_before from public.loyalty_ledger
 where customer_id=o.customer_id and (kind in ('earned','reversal') or (kind='adjustment' and note='Recalibração histórica de pontos (migração 0022)'));
 rank_before:=rank_before+coalesce((select sum(rank_points) from public.loyalty_rank_history where customer_id=o.customer_id),0);
 rate:=case when rank_before<1000 then 0.5 when rank_before<5000 then 1 when rank_before<15000 then 1.5 when rank_before<25000 then 2 when rank_before<50000 then 2.5 else 3 end;
 coins:=round(o.amount*rate,2);
 if coins<=0 then return 0;end if;
 select title into campaign_title from public.raffle_campaigns where id=o.campaign_id;
 insert into public.loyalty_ledger(customer_id,points,kind,raffle_order_id,lot_value,earn_rate,note)
 values(o.customer_id,coins,'earned',o.id,o.amount,rate,'Compra de cotas — '||campaign_title||' · Pedido '||o.code||' · taxa do elo no crédito') on conflict do nothing;
 if not found then return 0;end if;
 return coins;
end;$$;
revoke all on function public.credit_paid_raffle_caracoins(uuid) from public,anon,authenticated,service_role;

create function public.raffle_order_caracoins() returns trigger
language plpgsql security definer set search_path='' as $$
declare credit public.loyalty_ledger%rowtype;
begin
 select * into credit from public.loyalty_ledger where raffle_order_id=new.id and kind='earned';
 if tg_op='UPDATE' and credit.id is not null and (new.customer_id is distinct from old.customer_id or new.amount is distinct from old.amount or new.campaign_id is distinct from old.campaign_id) then
  raise exception 'Esta compra já gerou Caracoins. Preserve cliente, campanha e valor; faça um ajuste auditado para corrigir.';
 end if;
 if new.status='paid' then
  if tg_op='INSERT' or old.status is distinct from 'paid' then perform public.credit_paid_raffle_caracoins(new.id);end if;
 elsif credit.id is not null then
  insert into public.loyalty_ledger(customer_id,points,kind,raffle_order_id,note)
  values(credit.customer_id,-credit.points,'reversal',new.id,'Estorno de Caracoins da rifa · Pedido '||new.code||' · pagamento cancelado ou em análise') on conflict do nothing;
 end if;
 return new;
end;$$;
revoke all on function public.raffle_order_caracoins() from public,anon,authenticated,service_role;
create trigger raffle_order_caracoins after insert or update of status,amount,customer_id,campaign_id on public.raffle_orders for each row execute function public.raffle_order_caracoins();

-- Like auction reversals: expired coins must not become a debt for a second time.
create function public.raffle_coin_expired_reversal() returns trigger
language plpgsql security definer set search_path='' as $$
declare expired_reversal numeric;
begin
 if new.raffle_order_id is null or new.kind<>'reversal' then return new;end if;
 perform 1 from public.customers where id=new.customer_id for update;
 if exists(select 1 from public.loyalty_ledger where raffle_order_id=new.raffle_order_id and kind='reversal') then return new;end if;
 perform public.expire_customer_caracoins(new.customer_id);
 with credits as (
  select points,raffle_order_id,sum(points) over(order by created_at,id rows unbounded preceding) as finish
  from public.loyalty_ledger where customer_id=new.customer_id and points>0
 ),debits as (
  select -points as amount,coin_event,sum(-points) over(order by created_at,id rows unbounded preceding) as finish
  from public.loyalty_ledger where customer_id=new.customer_id and points<0
 )select least(-new.points,coalesce(sum(greatest(0,least(c.finish,d.finish)-greatest(c.finish-c.points,d.finish-d.amount))),0))
 into expired_reversal from credits c cross join debits d where c.raffle_order_id=new.raffle_order_id and d.coin_event='expiry';
 if expired_reversal>0 then
  insert into public.loyalty_ledger(customer_id,points,kind,note)
  values(new.customer_id,expired_reversal,'adjustment','Compensação no estorno de moedas da rifa já expiradas; sem pontos de ranking.');
 end if;
 return new;
end;$$;
revoke all on function public.raffle_coin_expired_reversal() from public,anon,authenticated,service_role;
create trigger aa_raffle_coin_expired_reversal before insert on public.loyalty_ledger for each row execute function public.raffle_coin_expired_reversal();
commit;
