-- Ativação: pendências existentes recebem 24h de tolerância; novos lotes contam do cadastro.
begin;
alter table public.lots add column if not exists payment_due_at timestamptz;
alter table public.lots add column if not exists payment_reminded_at timestamptz;
alter table public.lots add column if not exists payment_last_warning_at timestamptz;
alter table public.lots add column if not exists payment_expired_at timestamptz;
alter table public.lots add column if not exists payment_expiry_retry_at timestamptz;
update public.lots set payment_due_at=now()+interval '24 hours' where status='pending_payment' and arremate_value>0 and payment_due_at is null;
create index if not exists lots_payment_deadline_idx on public.lots(payment_due_at,payment_expiry_retry_at) where status='pending_payment' and arremate_value>0;
create or replace function public.set_lot_payment_deadline() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' and new.status='pending_payment' and new.arremate_value>0 then new.payment_due_at:=coalesce(new.created_at,now())+interval '24 hours';end if;
 if tg_op='UPDATE' then
  if new.status in('paid','shipped','delivered') and new.status is distinct from old.status then new.payment_expired_at:=null;end if;
  if old.status<>'pending_payment' and new.status='pending_payment' and new.arremate_value>0 then
   new.payment_due_at:=now()+interval '24 hours';new.payment_expired_at:=null;new.payment_reminded_at:=null;new.payment_last_warning_at:=null;new.payment_expiry_retry_at:=null;
  elsif new.status='pending_payment' and new.arremate_value>0 and old.payment_due_at is null then new.payment_due_at:=now()+interval '24 hours';end if;
  if new.charge_id is distinct from old.charge_id and new.charge_id is not null and new.status='pending_payment' and new.payment_due_at<=now() then raise exception 'O prazo de pagamento deste lote encerrou. Atualize o painel.';end if;
 end if;
 return new;
end $$;
drop trigger if exists lot_payment_deadline on public.lots;
create trigger lot_payment_deadline before insert or update on public.lots for each row execute function public.set_lot_payment_deadline();

create or replace function public.notify_auction_payment_deadlines() returns integer language plpgsql security definer set search_path='' as $$
declare n integer:=0;extra integer;
begin
 with picked as(select id from public.lots where status='pending_payment' and paid_at is null and arremate_value>0 and payment_due_at>now()+interval '2 hours' and payment_due_at<=now()+interval '12 hours' and payment_reminded_at is null order by payment_due_at,id limit 200 for update skip locked),
 updated as(update public.lots l set payment_reminded_at=now() from picked p where l.id=p.id returning l.*)
 insert into public.customer_notifications(customer_id,kind,title,body,href,dedupe_key)
 select customer_id,'lot_payment_reminder','Seus lotes aguardam pagamento',count(*)||' lote(s) pendente(s). Prazo máximo de 24h por lote. Pague até '||to_char(min(payment_due_at) at time zone 'America/Sao_Paulo','DD/MM HH24:MI')||' para manter seus arremates.','/painel/pix','auction_12h:'||(array_agg(id::text order by id))[1] from updated group by customer_id on conflict do nothing;
 get diagnostics n=row_count;
 with picked as(select id from public.lots where status='pending_payment' and paid_at is null and arremate_value>0 and payment_due_at>now() and payment_due_at<=now()+interval '2 hours' and payment_last_warning_at is null order by payment_due_at,id limit 200 for update skip locked),
 updated as(update public.lots l set payment_last_warning_at=now() from picked p where l.id=p.id returning l.*)
 insert into public.customer_notifications(customer_id,kind,title,body,href,dedupe_key)
 select customer_id,'lot_payment_last_warning','Últimas horas para pagar',count(*)||' lote(s) vencem em até 2 horas. Após o prazo, os arremates não pagos serão cancelados.','/painel/pix','auction_22h:'||(array_agg(id::text order by id))[1] from updated group by customer_id on conflict do nothing;
 get diagnostics extra=row_count;return n+extra;
end $$;
revoke all on function public.notify_auction_payment_deadlines() from public,anon,authenticated;
grant execute on function public.notify_auction_payment_deadlines() to service_role;

create or replace function public.claim_auction_payment_expirations(p_limit integer default 5)
returns table(id uuid,charge_id uuid) language sql security definer set search_path='' as $$
 with picked as(select l.id from public.lots l where l.status='pending_payment' and l.paid_at is null and l.arremate_value>0 and l.payment_due_at<=now() and (l.payment_expiry_retry_at is null or l.payment_expiry_retry_at<=now()) order by l.payment_due_at,l.id limit least(greatest(p_limit,1),20) for update skip locked)
 update public.lots l set payment_expiry_retry_at=now()+interval '2 minutes' from picked p where l.id=p.id returning l.id,l.charge_id;
$$;
revoke all on function public.claim_auction_payment_expirations(integer) from public,anon,authenticated;
grant execute on function public.claim_auction_payment_expirations(integer) to service_role;

-- Reparação de vínculo terminal: o chamador confirma esses dados na API autenticada.
create or replace function public.release_closed_auction_charge(p_charge uuid,p_remote_id text,p_reference text,p_amount numeric,p_status text) returns boolean
language plpgsql security definer set search_path='' as $$
declare c public.charges%rowtype;
begin
 select * into c from public.charges where id=p_charge for update;
 if not found or c.status::text not in('cancelled','expired','rejected') or p_status not in('cancelled','expired','rejected') or c.mp_payment_id is distinct from p_remote_id or c.external_reference is distinct from p_reference or c.amount is distinct from p_amount then return false;end if;
 update public.lots set charge_id=null where charge_id=c.id and status='pending_payment' and paid_at is null;
 return true;
end $$;
revoke all on function public.release_closed_auction_charge(uuid,text,text,numeric,text) from public,anon,authenticated;
grant execute on function public.release_closed_auction_charge(uuid,text,text,numeric,text) to service_role;

create or replace function public.expire_unpaid_auction_lot(p_lot uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare l public.lots%rowtype;
begin
 select * into l from public.lots where id=p_lot for update;
 if not found or l.status<>'pending_payment' or l.arremate_value<=0 or l.payment_due_at is null or l.payment_due_at>now() or l.paid_at is not null or l.charge_id is not null then return false;end if;
 -- Inconsistências físicas exigem conferência humana; não devolver estoque nem apagar vínculos.
 if l.moved_at is not null or exists(select 1 from public.lot_items where lot_id=l.id and applied) or exists(select 1 from public.shipment_lots sl join public.shipments s on s.id=sl.shipment_id where sl.lot_id=l.id and s.status<>'cancelled') then return false;end if;
 update public.lots set status='cancelled',payment_expired_at=now(),updated_at=now() where id=l.id;
 insert into public.customer_notifications(customer_id,kind,title,body,href,dedupe_key) values(l.customer_id,'lot_payment_expired','Lote cancelado por prazo encerrado','O prazo de 24h do lote '||l.code||' terminou sem pagamento confirmado. O arremate foi cancelado.','/painel','auction_expired:'||l.id::text||':'||l.payment_due_at::text) on conflict do nothing;
 return true;
end $$;
revoke all on function public.expire_unpaid_auction_lot(uuid) from public,anon,authenticated;
grant execute on function public.expire_unpaid_auction_lot(uuid) to service_role;
commit;
