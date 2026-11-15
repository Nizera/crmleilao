-- Primeiro dia de leilão: 12h. Histórico existente e demais dias: 24h.
-- Não altera nenhum vencimento já cadastrado nem aplica advertências retroativas.
begin;
alter table public.lots add column payment_term_hours smallint not null default 24 check(payment_term_hours in(12,24));
create table public.customer_auction_terms(
 customer_id uuid primary key references public.customers(id) on delete cascade,
 first_auction_date date,
 legacy_customer boolean not null default false,
 created_at timestamptz not null default now()
);
alter table public.customer_auction_terms enable row level security;
revoke all on public.customer_auction_terms from public,anon,authenticated;
grant all on public.customer_auction_terms to service_role;
insert into public.customer_auction_terms(customer_id,first_auction_date,legacy_customer)
 select customer_id,min(auction_date),true from public.lots group by customer_id;

create or replace function public.set_lot_payment_deadline() returns trigger
language plpgsql security definer set search_path='' as $$
declare terms public.customer_auction_terms%rowtype; auction_day date;
begin
 if tg_op='INSERT' then
  -- Uma inscrição por cliente mantém o primeiro leilão mesmo após cancelamento ou exclusão de lotes.
  perform 1 from public.customers where id=new.customer_id for update;
  auction_day:=coalesce(new.auction_date,(coalesce(new.created_at,now()) at time zone 'America/Sao_Paulo')::date);
  insert into public.customer_auction_terms(customer_id,first_auction_date) values(new.customer_id,auction_day) on conflict(customer_id) do nothing;
  select * into terms from public.customer_auction_terms where customer_id=new.customer_id;
  new.payment_term_hours:=case when not terms.legacy_customer and terms.first_auction_date=auction_day then 12 else 24 end;
  if new.status='pending_payment' and new.arremate_value>0 then new.payment_due_at:=coalesce(new.created_at,now())+make_interval(hours=>new.payment_term_hours);end if;
 end if;
 if tg_op='UPDATE' then
  -- O prazo original do lote não muda ao editar sua data, o cliente ou outros campos.
  new.payment_term_hours:=old.payment_term_hours;
  if new.status in('paid','shipped','delivered') and new.status is distinct from old.status then new.payment_expired_at:=null;end if;
  if old.status<>'pending_payment' and new.status='pending_payment' and new.arremate_value>0 then
   new.payment_due_at:=now()+make_interval(hours=>new.payment_term_hours);
   new.payment_expired_at:=null;new.payment_reminded_at:=null;new.payment_last_warning_at:=null;new.payment_expiry_retry_at:=null;
  end if;
  if new.charge_id is distinct from old.charge_id and new.charge_id is not null and new.status='pending_payment' and new.payment_due_at<=now() then raise exception 'O prazo de pagamento deste lote encerrou. Atualize o painel.';end if;
 end if;
 return new;
end $$;
revoke all on function public.set_lot_payment_deadline() from public,anon,authenticated;

create or replace function public.notify_auction_payment_deadlines() returns integer language plpgsql security definer set search_path='' as $$
declare n integer:=0;extra integer;
begin
 with picked as(select id from public.lots where status='pending_payment' and paid_at is null and arremate_value>0 and not exists(select 1 from public.charges c where c.id=lots.charge_id and c.pix_issue_since is not null and c.status::text in('pending','in_process')) and payment_due_at>now()+interval '2 hours' and payment_due_at<=now()+make_interval(hours=>payment_term_hours/2) and payment_reminded_at is null order by payment_due_at,id limit 200 for update skip locked),
 updated as(update public.lots l set payment_reminded_at=now() from picked p where l.id=p.id returning l.*)
 insert into public.customer_notifications(customer_id,kind,title,body,href,dedupe_key)
 select customer_id,'lot_payment_reminder','Seus lotes aguardam pagamento',count(*)||' lote(s) pendente(s). Pague até '||to_char(min(payment_due_at) at time zone 'America/Sao_Paulo','DD/MM HH24:MI')||' para manter seus arremates.','/painel/pix','auction_12h:'||(array_agg(id::text order by id))[1] from updated group by customer_id on conflict do nothing;
 get diagnostics n=row_count;
 with picked as(select id from public.lots where status='pending_payment' and paid_at is null and arremate_value>0 and not exists(select 1 from public.charges c where c.id=lots.charge_id and c.pix_issue_since is not null and c.status::text in('pending','in_process')) and payment_due_at>now() and payment_due_at<=now()+interval '2 hours' and payment_last_warning_at is null order by payment_due_at,id limit 200 for update skip locked),
 updated as(update public.lots l set payment_last_warning_at=now() from picked p where l.id=p.id returning l.*)
 insert into public.customer_notifications(customer_id,kind,title,body,href,dedupe_key)
 select customer_id,'lot_payment_last_warning','Últimas horas para pagar',count(*)||' lote(s) vencem em até 2 horas. Após o prazo, os arremates não pagos serão cancelados.','/painel/pix','auction_22h:'||(array_agg(id::text order by id))[1] from updated group by customer_id on conflict do nothing;
 get diagnostics extra=row_count;return n+extra;
end $$;
revoke all on function public.notify_auction_payment_deadlines() from public,anon,authenticated;
grant execute on function public.notify_auction_payment_deadlines() to service_role;


create or replace function public.expire_unpaid_auction_lot(p_lot uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare l public.lots%rowtype;
begin
 select * into l from public.lots where id=p_lot for update;
 if not found or l.status<>'pending_payment' or l.arremate_value<=0 or l.payment_due_at is null or l.payment_due_at>now() or l.paid_at is not null or l.charge_id is not null then return false;end if;
 -- Inconsistências físicas exigem conferência humana; não devolver estoque nem apagar vínculos.
 if l.moved_at is not null or exists(select 1 from public.lot_items where lot_id=l.id and applied) or exists(select 1 from public.shipment_lots sl join public.shipments s on s.id=sl.shipment_id where sl.lot_id=l.id and s.status<>'cancelled') then return false;end if;
 update public.lots set status='cancelled',payment_expired_at=now(),updated_at=now() where id=l.id;
 insert into public.customer_notifications(customer_id,kind,title,body,href,dedupe_key) values(l.customer_id,'lot_payment_expired','Lote cancelado por prazo encerrado','O prazo de '||l.payment_term_hours||'h do lote '||l.code||' terminou sem pagamento confirmado. O arremate foi cancelado.','/painel','auction_expired:'||l.id::text||':'||l.payment_due_at::text) on conflict do nothing;
 return true;
end $$;
revoke all on function public.expire_unpaid_auction_lot(uuid) from public,anon,authenticated;
grant execute on function public.expire_unpaid_auction_lot(uuid) to service_role;

commit;
