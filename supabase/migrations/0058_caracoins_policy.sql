-- Política: 100 moedas/R$1, um voucher de até R$20, moedas válidas por 90 dias.
-- Saldos anteriores ganham 90 dias a partir desta implantação. Elo não expira.
begin;
alter table public.loyalty_ledger add column coins_expires_at timestamptz,
  add column coin_event text check(coin_event in ('expiry','welcome','welcome_reversal'));
update public.loyalty_ledger set coins_expires_at=now()+interval '90 days' where points>0;
create index loyalty_coin_expiration on public.loyalty_ledger(customer_id,coins_expires_at) where points>0;
create index if not exists loyalty_coin_fifo on public.loyalty_ledger(customer_id,created_at,id);
update public.loyalty_settings set points_expire_days=90 where id;

-- FIFO: todos os débitos (inclusive estornos e expirações) consomem os créditos antigos.
create function public.loyalty_expired_unspent(p_customer uuid) returns numeric
language sql stable security definer set search_path='' as $$
 with credits as (
  select points,coins_expires_at,sum(points) over(order by created_at,id rows unbounded preceding) as cumulative
  from public.loyalty_ledger where customer_id=p_customer and points>0
 ), debits as (select coalesce(-sum(points),0) as total from public.loyalty_ledger where customer_id=p_customer and points<0)
 select coalesce(sum(greatest(0,least(c.points,c.cumulative-d.total))),0)
 from credits c cross join debits d where c.coins_expires_at<=now();
$$;
revoke all on function public.loyalty_expired_unspent(uuid) from public,anon,authenticated;

create function public.expire_customer_caracoins(p_customer uuid) returns numeric
language plpgsql security definer set search_path='' as $$
declare amount numeric;
begin
 perform 1 from public.customers where id=p_customer for update;
 amount:=public.loyalty_expired_unspent(p_customer);
 if amount>0 then
  insert into public.loyalty_ledger(customer_id,points,kind,coin_event,note)
  values(p_customer,-amount,'adjustment','expiry','Caracoins expiradas após 90 dias; pontuação do elo preservada.');
 end if;
 return amount;
end $$;
revoke all on function public.expire_customer_caracoins(uuid) from public,anon,authenticated;
grant execute on function public.expire_customer_caracoins(uuid) to service_role;

create function public.guard_caracoins_expiry_0058() returns trigger
language plpgsql security definer set search_path='' as $$
declare balance numeric;
begin
 perform 1 from public.customers where id=new.customer_id for update;
 if new.points>0 then new.coins_expires_at:=now()+interval '90 days'; end if;
 if new.points<0 and new.coin_event is distinct from 'expiry' then
  perform public.expire_customer_caracoins(new.customer_id);
  if new.kind='spent' then
   select coalesce(sum(points),0) into balance from public.loyalty_ledger where customer_id=new.customer_id;
   if balance+new.points<0 then raise exception 'Saldo de Caracoins insuficiente ou expirado.';end if;
  end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_caracoins_expiry_0058() from public,anon,authenticated;
create trigger caracoins_expiry_guard before insert on public.loyalty_ledger for each row execute function public.guard_caracoins_expiry_0058();

create or replace function public.get_customer_loyalty_balance(p_customer_id uuid default null)
returns numeric language plpgsql stable security definer set search_path='' as $$
declare customer uuid:=coalesce(p_customer_id,public.current_customer_id());
begin
 if customer is null or (not coalesce(public.is_admin(),false) and customer is distinct from public.current_customer_id()) then raise exception 'Acesso negado.';end if;
 return coalesce((select sum(points) from public.loyalty_ledger where customer_id=customer),0)-public.loyalty_expired_unspent(customer);
end $$;
revoke all on function public.get_customer_loyalty_balance(uuid) from public,anon;
grant execute on function public.get_customer_loyalty_balance(uuid) to authenticated;

create function public.expire_due_caracoins(p_limit integer default 200) returns integer
language plpgsql security definer set search_path='' as $$
declare c record;n integer:=0;
begin
 for c in select distinct customer_id from public.loyalty_ledger where points>0 and coins_expires_at<=now()
  and public.loyalty_expired_unspent(customer_id)>0 order by customer_id limit least(500,greatest(1,p_limit))
 loop perform public.expire_customer_caracoins(c.customer_id);n:=n+1;end loop;
 return n;
end $$;
revoke all on function public.expire_due_caracoins(integer) from public,anon,authenticated;
grant execute on function public.expire_due_caracoins(integer) to service_role;

-- Um claim por cliente impede repetição por Pix, reprocessamento ou cancelamento.
create table public.loyalty_welcome_claims(
 customer_id uuid primary key references public.customers(id),lot_id uuid references public.lots(id),
 status text not null check(status in('existing','awarded','reversed')),created_at timestamptz not null default now()
);
alter table public.loyalty_welcome_claims enable row level security;
revoke all on public.loyalty_welcome_claims from public,anon,authenticated;
grant all on public.loyalty_welcome_claims to service_role;
insert into public.loyalty_welcome_claims(customer_id,status)
 select c.id,'existing' from public.customers c where
 exists(select 1 from public.lots l where l.customer_id=c.id and l.arremate_value>0 and l.status in('paid','shipped','delivered'))
 or exists(select 1 from public.loyalty_ledger l where l.customer_id=c.id and l.kind='earned')
 or exists(select 1 from public.loyalty_rank_history h where h.customer_id=c.id and h.paid_amount>0);

create function public.first_purchase_caracoins() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='paid' and new.arremate_value>0 and (tg_op='INSERT' or old.status is distinct from 'paid')
  then
  perform 1 from public.customers where id=new.customer_id for update;
  insert into public.loyalty_welcome_claims(customer_id,lot_id,status) values(new.customer_id,new.id,case when exists(select 1 from public.loyalty_settings where id and active) then 'awarded' else 'existing' end) on conflict do nothing;
  if found and exists(select 1 from public.loyalty_settings where id and active) then
   insert into public.loyalty_ledger(customer_id,points,kind,coin_event,note)
    values(new.customer_id,500,'adjustment','welcome','Bônus de 500 Caracoins na primeira compra paga do leilão.');
   insert into public.loyalty_rank_history(customer_id,source_key,paid_amount,rank_points,note)
    values(new.customer_id,'welcome-bonus-0058',0,500,'Bônus da primeira compra; não representa gasto em reais.');
  end if;
 end if;
 return new;
end $$;
revoke all on function public.first_purchase_caracoins() from public,anon,authenticated;
-- AFTER: o lote já existe, inclusive em INSERT, antes de referenciá-lo no claim.
create trigger first_purchase_caracoins after insert or update of status on public.lots for each row execute function public.first_purchase_caracoins();

create function public.reverse_welcome_caracoins() returns trigger
language plpgsql security definer set search_path='' as $$
declare expired_bonus numeric;
begin
 if new.status='cancelled' and old.status is distinct from 'cancelled' then
  perform 1 from public.customers where id=new.customer_id for update;
  if not exists(select 1 from public.lots where customer_id=new.customer_id and arremate_value>0 and status in('paid','shipped','delivered')) then
   update public.loyalty_welcome_claims set status='reversed' where customer_id=new.customer_id and status='awarded';
   if found then
    -- Não estorna uma segunda vez a parcela do bônus já expirada.
    perform public.expire_customer_caracoins(new.customer_id);
    with credits as (select points,coin_event,sum(points) over(order by created_at,id rows unbounded preceding) as finish
     from public.loyalty_ledger where customer_id=new.customer_id and points>0),
    debits as (select -points as amount,coin_event,sum(-points) over(order by created_at,id rows unbounded preceding) as finish
     from public.loyalty_ledger where customer_id=new.customer_id and points<0)
    select coalesce(sum(greatest(0,least(c.finish,d.finish)-greatest(c.finish-c.points,d.finish-d.amount))),0)
     into expired_bonus from credits c cross join debits d where c.coin_event='welcome' and d.coin_event='expiry';
    if expired_bonus<500 then
     insert into public.loyalty_ledger(customer_id,points,kind,coin_event,note)
      values(new.customer_id,-(500-expired_bonus),'adjustment','welcome_reversal','Estorno do bônus: todas as compras pagas foram canceladas.');
    end if;
    update public.loyalty_rank_history set rank_points=0 where customer_id=new.customer_id and source_key='welcome-bonus-0058';
   end if;
  end if;
 end if;
 return new;
end $$;
revoke all on function public.reverse_welcome_caracoins() from public,anon,authenticated;
create trigger reverse_welcome_caracoins after update of status on public.lots for each row execute function public.reverse_welcome_caracoins();

-- Preços novos são fixos. Vouchers já emitidos preservam custo e validade originais.
update public.store_voucher_templates set active=false where discount_cash is not null and discount_cash not in(5,10,15,20);
do $$ declare amount integer;chosen uuid;begin
 foreach amount in array array[5,10,15,20] loop
  select id into chosen from public.store_voucher_templates where discount_cash=amount order by created_at,id limit 1;
  if chosen is null then
   insert into public.store_voucher_templates(name,coins_cost,discount_cash,min_purchase,validity_days,max_per_customer,active)
    values('Voucher R$ '||amount,amount*100,amount,amount,30,10000,true);
  else
   update public.store_voucher_templates set name='Voucher R$ '||amount,coins_cost=amount*100,min_purchase=amount,active=true,updated_at=now(),max_per_customer=10000 where id=chosen;
   update public.store_voucher_templates set active=false where discount_cash=amount and id<>chosen;
  end if;
 end loop;
end $$;
alter table public.store_voucher_templates add constraint voucher_policy_0058
 check(not active or (discount_cash in(5,10,15,20) and coins_cost=discount_cash*100));

create function public.guard_store_voucher_limit() returns trigger
language plpgsql set search_path='' as $$begin
 if new.discount_cash>20 then raise exception 'O desconto máximo é de R$ 20 por compra.';end if;
 return new;
end $$;
revoke all on function public.guard_store_voucher_limit() from public,anon,authenticated;
create trigger store_voucher_limit before insert or update of voucher_id,discount_cash on public.store_orders for each row execute function public.guard_store_voucher_limit();
create or replace function public.save_loyalty_settings(
  p_active boolean, p_points_per_real numeric, p_ranking_enabled boolean, p_note text default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_staff_write() then raise exception 'Acesso negado.'; end if;
  if p_active and not exists (select 1 from public.loyalty_rewards where active
    and internal_cost is not null and (points_cost is not null or cash_price is not null or mixed_cash_price is not null)) then
    raise exception 'Cadastre um produto ativo com preço e custo interno.';
  end if;
  insert into public.loyalty_settings(id, active, points_per_real, points_expire_days, ranking_enabled, updated_by, updated_at)
  values (true, p_active, null, 90, p_ranking_enabled, auth.uid(), now())
  on conflict (id) do update set active = excluded.active, points_per_real = null,
    points_expire_days = 90, ranking_enabled = excluded.ranking_enabled,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into public.loyalty_settings_history(active, ranking_enabled, note, changed_by)
  values (p_active, p_ranking_enabled, nullif(left(p_note,500),''), auth.uid());
end;
$$;


create or replace function public.search_loyalty_customers(p_query text)
returns table(id uuid,name text,phone_e164 text,balance numeric) language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'Acesso negado.'; end if;
 if char_length(trim(coalesce(p_query,'')))<2 then return; end if;
 return query select c.id,c.name,c.phone_e164,
 public.get_customer_loyalty_balance(c.id)
 from public.customers c where strpos(lower(coalesce(c.name,'')||' '||c.phone_e164),lower(left(trim(p_query),100)))>0
 order by c.name nulls last,c.id limit 20;
end; $$;
revoke all on function public.search_loyalty_customers(text) from public,anon;
grant execute on function public.search_loyalty_customers(text) to authenticated;


commit;
