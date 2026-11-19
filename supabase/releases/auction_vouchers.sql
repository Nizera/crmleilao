begin;
create table public.auction_vouchers (
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null unique references public.raffle_buyer_results(campaign_id),
 customer_id uuid not null references public.customers(id),
 title text not null, amount numeric(12,2) not null check(amount>0),
 remaining numeric(12,2) not null check(remaining>=0 and remaining<=amount),
 created_at timestamptz not null default now()
);
alter table public.auction_vouchers enable row level security;
revoke all on public.auction_vouchers from public,anon,authenticated;
grant select on public.auction_vouchers to authenticated;
grant all on public.auction_vouchers to service_role;
create policy auction_vouchers_read on public.auction_vouchers for select to authenticated
 using(public.is_admin() or customer_id=public.current_customer_id());
create index auction_vouchers_customer on public.auction_vouchers(customer_id,created_at);

alter table public.lots add column auction_voucher_id uuid references public.auction_vouchers(id),
 add column voucher_amount numeric(12,2) not null default 0,
 add constraint lots_voucher_amount check(voucher_amount>=0 and voucher_amount<=discount_amount and ((voucher_amount=0 and auction_voucher_id is null) or (voucher_amount>0 and auction_voucher_id is not null)));
create index lots_auction_voucher on public.lots(auction_voucher_id) where auction_voucher_id is not null;

create table public.auction_voucher_movements (
 id uuid primary key default gen_random_uuid(),voucher_id uuid not null references public.auction_vouchers(id),
 lot_id uuid not null,delta numeric(12,2) not null check(delta<>0),
 actor uuid,created_at timestamptz not null default now()
);
alter table public.auction_voucher_movements enable row level security;
revoke all on public.auction_voucher_movements from public,anon,authenticated;
grant all on public.auction_voucher_movements to service_role;
create index auction_voucher_movements_voucher on public.auction_voucher_movements(voucher_id,created_at);

create function public.issue_raffle_auction_voucher() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.delivery_kind='voucher' and new.status='pending' then
  insert into public.auction_vouchers(campaign_id,customer_id,title,amount,remaining)
  values(new.campaign_id,new.customer_id,new.title,new.amount,new.amount) on conflict(campaign_id) do nothing;
  update public.raffle_buyer_results set status='fulfilled',fulfilled_at=now(),fulfillment_note='Crédito de voucher disponibilizado automaticamente para uso nos lotes do leilão.' where campaign_id=new.campaign_id;
 end if;
 return new;
end;$$;
revoke all on function public.issue_raffle_auction_voucher() from public,anon,authenticated,service_role;
create trigger issue_raffle_auction_voucher after insert on public.raffle_buyer_results
 for each row execute function public.issue_raffle_auction_voucher();

-- Pending awards only: previously fulfilled/manual vouchers must never be issued twice.
insert into public.auction_vouchers(campaign_id,customer_id,title,amount,remaining)
 select campaign_id,customer_id,title,amount,amount from public.raffle_buyer_results
 where delivery_kind='voucher' and status='pending' on conflict(campaign_id) do nothing;
update public.raffle_buyer_results r set status='fulfilled',fulfilled_at=now(),fulfillment_note='Crédito de voucher disponibilizado automaticamente para uso nos lotes do leilão.'
 where r.delivery_kind='voucher' and r.status='pending' and exists(select 1 from public.auction_vouchers v where v.campaign_id=r.campaign_id);

create function public.apply_lot_auction_voucher() returns trigger
language plpgsql security definer set search_path='' as $$
declare old_id uuid;new_id uuid;old_amount numeric:=0;new_amount numeric:=0;v public.auction_vouchers%rowtype;financial boolean:=false;
begin
 if tg_op<>'INSERT' then
  old_id:=old.auction_voucher_id;
  if old.status<>'cancelled' then old_amount:=old.voucher_amount;end if;
 end if;
 if tg_op<>'DELETE' then
  new_id:=new.auction_voucher_id;
  if new.status<>'cancelled' then new_amount:=new.voucher_amount;end if;
  if new.voucher_amount<0 or new.voucher_amount>new.discount_amount or (new.voucher_amount>0)<>(new_id is not null) then raise exception 'Confira o voucher e o desconto do lote.';end if;
 end if;
 financial:=tg_op='DELETE' or tg_op='INSERT';
 if tg_op='UPDATE' then financial:=(old_id,old.voucher_amount,old.customer_id,old.arremate_value,old.discount_amount) is distinct from (new_id,new.voucher_amount,new.customer_id,new.arremate_value,new.discount_amount) or (old.status='cancelled')<>(new.status='cancelled');end if;
 if old_id is null and new_id is null then return coalesce(new,old);end if;
 if financial then
  if not (public.has_staff_write() is true or current_setting('role',true)='service_role' or (session_user='postgres' and current_setting('role',true) in('none','postgres'))) then raise exception 'Acesso negado.' using errcode='42501';end if;
  if tg_op<>'INSERT' and (old.charge_id is not null or old.paid_at is not null or old.status in('shipped','delivered') or old.moved_at is not null or (old.status='paid' and old.arremate_value>0)) then raise exception 'Confira o pagamento, a movimentação e o Pix antes de alterar o voucher.';end if;
  perform id from public.auction_vouchers where id in(old_id,new_id) order by id for update;
  if new_amount>0 then
   select * into v from public.auction_vouchers where id=new_id;
   if not found or v.customer_id<>new.customer_id or exists(select 1 from public.raffle_buyer_results where campaign_id=v.campaign_id and status='review') then raise exception 'Voucher indisponível para este cliente ou em revisão.';end if;
   if new_amount>(v.remaining+case when old_id=new_id then old_amount else 0 end) then raise exception 'Saldo de voucher insuficiente. Atualize o cadastro do lote.';end if;
  end if;
  if old_amount>0 then
   update public.auction_vouchers set remaining=remaining+old_amount where id=old_id;
   insert into public.auction_voucher_movements(voucher_id,lot_id,delta,actor) values(old_id,old.id,old_amount,auth.uid());
  end if;
  if new_amount>0 then
   update public.auction_vouchers set remaining=remaining-new_amount where id=new_id;
   insert into public.auction_voucher_movements(voucher_id,lot_id,delta,actor) values(new_id,new.id,-new_amount,auth.uid());
  end if;
 end if;
 if tg_op='DELETE' then return old;end if;
 if new_amount>0 and new.arremate_value=0 and new.status='pending_payment' then new.status:='paid';end if;
 if tg_op='UPDATE' and old.voucher_amount>0 and old.arremate_value=0 and old.status='paid' and old.paid_at is null and new.arremate_value>0 and new.status='paid' then new.status:='pending_payment';end if;
 return new;
end;$$;
revoke all on function public.apply_lot_auction_voucher() from public,anon,authenticated,service_role;
create trigger apply_lot_auction_voucher before insert or update or delete on public.lots
 for each row execute function public.apply_lot_auction_voucher();

create function public.get_auction_vouchers(p_customer uuid default null,p_lot uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c uuid;
begin
 if public.is_admin() and auth.uid() is not null then c:=p_customer;
 else c:=public.current_customer_id();if c is null or (p_customer is not null and p_customer<>c) or p_lot is not null then raise exception 'Acesso negado.' using errcode='42501';end if;end if;
 if c is null then return '[]'::jsonb;end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'title',v.title,'amount',v.amount,'remaining',v.remaining,'available',v.remaining+coalesce(l.voucher_amount,0)) order by v.created_at,v.id),'[]'::jsonb)
 from public.auction_vouchers v join public.raffle_buyer_results r on r.campaign_id=v.campaign_id
 left join public.lots l on l.id=p_lot and l.customer_id=c and l.auction_voucher_id=v.id and l.status<>'cancelled'
 where v.customer_id=c and r.status<>'review' and (v.remaining>0 or l.voucher_amount>0));
end;$$;
revoke all on function public.get_auction_vouchers(uuid,uuid) from public,anon;
grant execute on function public.get_auction_vouchers(uuid,uuid) to authenticated;
CREATE OR REPLACE FUNCTION public.get_due_freight_periods_before_checkout(p_customer uuid)
 RETURNS TABLE(freight_period date, first_lot_id uuid, freight_amount numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select l.auction_date-((extract(dow from l.auction_date)::integer-2+7)%7),l.id,20::numeric
 from public.lots l where l.customer_id=p_customer and l.status in('pending_payment','paid') and (l.arremate_value>0 or l.voucher_amount>0)
 and not exists(select 1 from public.lot_freight_waivers w where w.lot_id=l.id and w.customer_id=l.customer_id)
 and not exists(select 1 from public.shipment_lots sl join public.shipments s on s.id=sl.shipment_id where sl.lot_id=l.id and s.status<>'cancelled')
 and not exists(select 1 from public.available_shipment_freight(p_customer))
 and not exists(select 1 from public.charges c where c.customer_id=p_customer and c.freight_amount>0 and c.status in('pending','in_process'))
 order by l.created_at,l.id limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.require_lot_period_freight()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if new.charge_id is null or new.charge_id is not distinct from old.charge_id then return new;end if;
 if new.arremate_value=0 and new.voucher_amount=0 then return new;end if;
 if exists(select 1 from public.lot_freight_waivers w where w.lot_id=new.id and w.customer_id=new.customer_id) then return new;end if;
 if not exists(select 1 from public.available_shipment_freight(new.customer_id))
 and not exists(select 1 from public.available_store_freight(new.customer_id))
 and not exists(select 1 from public.charge_freight_items where customer_id=new.customer_id and charge_id=new.charge_id and status in('pending','in_process','approved'))
 and not exists(select 1 from public.store_orders where customer_id=new.customer_id and freight_amount>0 and payment_status in('creating','pending','partially_refunded','payment_review'))
 then raise exception 'O frete de R$20 do envio acumulado deve acompanhar o pagamento dos lotes.';end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION public.is_company_prize_package(p_shipment uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(
  select 1 from public.shipments s
  where s.id=p_shipment
  and (
   exists(select 1 from public.shipment_lots where shipment_id=s.id)
   or exists(
    select 1 from public.logistics_pending p
    where p.customer_id=s.customer_id
    and p.source_kind='raffle'
    and p.cancelled_at is null
    and (
     p.shipment_id=s.id
     or (
      s.content_snapshot is null
      and p.shipment_id is null
      and p.shipping_date<=s.batch_date
     )
    )
   )
  )
  and not exists(
   select 1 from public.shipment_lots sl
   join public.lots l on l.id=sl.lot_id
   where sl.shipment_id=s.id
   and (
    l.customer_id<>s.customer_id
    or l.arremate_value<>0 or l.voucher_amount>0
    or l.status not in('paid','shipped','delivered')
   )
  )
  and not exists(
   select 1 from public.logistics_pending p
   left join public.raffle_awards a on a.logistics_id=p.id
   left join public.raffle_orders o on o.id=a.order_id
   where p.customer_id=s.customer_id
   and (
    p.shipment_id=s.id
    or (
     s.content_snapshot is null
     and p.shipment_id is null
     and p.cancelled_at is null
     and p.shipping_date<=s.batch_date
    )
   )
   and (
    p.source_kind not in('raffle','replacement')
    or p.cancelled_at is not null
    or (
     p.source_kind='raffle'
     and o.status is distinct from 'paid'
    )
   )
  )
  and not exists(
   select 1 from public.store_orders o
   where o.customer_id=s.customer_id
   and (
    o.shipment_id=s.id
    or (
     s.content_snapshot is null
     and o.shipment_id is null
     and o.payment_status='paid'
     and o.fulfillment_status<>'fulfilled'
     and o.created_at<(
      (s.batch_date+1)::timestamp at time zone 'America/Sao_Paulo'
     )
    )
   )
   and exists(
    select 1 from public.store_order_items i
    where i.order_id=o.id and i.delivery_kind='physical'
   )
  )
  and (
   s.content_snapshot is not null
   or not exists(
    select 1 from public.lots l
    where l.customer_id=s.customer_id
    and l.arremate_value>0
    and l.status='paid'
    and coalesce(l.shipping_date,s.batch_date)<=s.batch_date
    and not exists(
     select 1 from public.shipment_lots sl
     join public.shipments active on active.id=sl.shipment_id
     where sl.lot_id=l.id and active.status<>'cancelled'
    )
   )
  )
 );
$function$;

CREATE OR REPLACE FUNCTION public.get_my_raffle_buyer_bonuses()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(jsonb_build_object('campaign_id',r.campaign_id,'campaign_title',c.title,'title',r.title,'delivery_kind',r.delivery_kind,'amount',r.amount,'quantity',r.quantity,'status',r.status,'fulfilled_at',r.fulfilled_at,'has_logistics',r.prize_id is not null,'voucher_issued',v.id is not null,'voucher_available',v.remaining) order by r.created_at desc),'[]'::jsonb)
 from public.raffle_buyer_results r join public.raffle_campaigns c on c.id=r.campaign_id left join public.auction_vouchers v on v.campaign_id=r.campaign_id
 where auth.uid() is not null and r.customer_id=public.current_customer_id();
$function$;
commit;
notify pgrst, 'reload schema';
