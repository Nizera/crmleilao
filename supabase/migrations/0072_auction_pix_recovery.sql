begin;
alter table public.lots add column pix_paused_at timestamptz;
alter table public.charges
 add column pix_issue_since timestamptz,
 add column pix_issue_code text,
 add column pix_last_attempt_at timestamptz,
 add column pix_attempts integer not null default 0;

-- Service role only: clients cannot suspend deadlines or bypass the retry lease.
create function public.claim_charge_pix_attempt(p_charge uuid,p_background boolean default false) returns boolean
language plpgsql security definer set search_path='' as $$
declare c public.charges%rowtype;
begin
 select * into c from public.charges where id=p_charge for update;
 if not found or c.status::text not in ('pending','in_process') or
   (p_background and c.pix_attempts>=4) or
   (c.pix_last_attempt_at is not null and c.pix_last_attempt_at>now()-case when p_background then interval '5 minutes' else interval '30 seconds' end) then return false;end if;
 update public.charges set pix_last_attempt_at=now(),pix_attempts=pix_attempts+1 where id=c.id;
 return true;
end;$$;

create function public.record_charge_pix_issue(p_charge uuid,p_code text) returns void
language plpgsql security definer set search_path='' as $$
declare started timestamptz;
begin
 if p_code is null or p_code!~'^[a-z0-9_:,-]{1,160}$' then raise exception 'Código de diagnóstico inválido.';end if;
 update public.charges set pix_issue_since=coalesce(pix_issue_since,now()),pix_issue_code=case when p_code='preparing' and pix_issue_code is not null then pix_issue_code else p_code end
 where id=p_charge and status::text in ('pending','in_process') returning pix_issue_since into started;
 if started is not null then update public.lots set pix_paused_at=started where charge_id=p_charge and status='pending_payment' and paid_at is null;end if;
end;$$;

-- Called after saving a usable QR, or after verifying a terminal provider state.
-- Restore the unavailable time, with at least one hour to complete payment.
create function public.resolve_charge_pix_issue(p_charge uuid) returns void
language plpgsql security definer set search_path='' as $$
declare c public.charges%rowtype;
begin
 select * into c from public.charges where id=p_charge for update;
 if not found or c.pix_issue_since is null then return;end if;
 if c.pix_issue_code<>'preparing' or now()-c.pix_issue_since>=interval '30 seconds' then
  update public.lots set payment_due_at=greatest(payment_due_at+greatest(now()-c.pix_issue_since,interval '0'),now()+interval '1 hour'),payment_expiry_retry_at=null
  where charge_id=c.id and status='pending_payment' and paid_at is null and payment_due_at is not null;
 end if;
 update public.lots set pix_paused_at=null where charge_id=c.id;
 update public.charges set pix_issue_since=null,pix_issue_code=null where id=c.id;
end;$$;

revoke all on function public.claim_charge_pix_attempt(uuid,boolean),public.record_charge_pix_issue(uuid,text),public.resolve_charge_pix_issue(uuid) from public,anon,authenticated;
grant execute on function public.claim_charge_pix_attempt(uuid,boolean),public.record_charge_pix_issue(uuid,text),public.resolve_charge_pix_issue(uuid) to service_role;

-- A second check in the database protects against expiration races.
create function public.guard_pix_issue_expiration() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status<>'pending_payment' then new.pix_paused_at:=null;end if;
 if new.status='cancelled' and old.status='pending_payment' and new.payment_expired_at is not null
 and old.charge_id is not null and exists(select 1 from public.charges c where c.id=old.charge_id and c.status::text in('pending','in_process') and c.pix_issue_since is not null)
 then raise exception 'Lote protegido durante a recuperação do Pix.';end if;
 return new;
end;$$;
revoke all on function public.guard_pix_issue_expiration() from public,anon,authenticated;
create trigger protect_lot_pix_generation before update on public.lots for each row execute function public.guard_pix_issue_expiration();

create or replace function public.notify_auction_payment_deadlines() returns integer language plpgsql security definer set search_path='' as $$
declare n integer:=0;extra integer;
begin
 with picked as(select id from public.lots where status='pending_payment' and paid_at is null and arremate_value>0 and not exists(select 1 from public.charges c where c.id=lots.charge_id and c.pix_issue_since is not null and c.status::text in('pending','in_process')) and payment_due_at>now()+interval '2 hours' and payment_due_at<=now()+interval '12 hours' and payment_reminded_at is null order by payment_due_at,id limit 200 for update skip locked),
 updated as(update public.lots l set payment_reminded_at=now() from picked p where l.id=p.id returning l.*)
 insert into public.customer_notifications(customer_id,kind,title,body,href,dedupe_key)
 select customer_id,'lot_payment_reminder','Seus lotes aguardam pagamento',count(*)||' lote(s) pendente(s). Prazo máximo de 24h por lote. Pague até '||to_char(min(payment_due_at) at time zone 'America/Sao_Paulo','DD/MM HH24:MI')||' para manter seus arremates.','/painel/pix','auction_12h:'||(array_agg(id::text order by id))[1] from updated group by customer_id on conflict do nothing;
 get diagnostics n=row_count;
 with picked as(select id from public.lots where status='pending_payment' and paid_at is null and arremate_value>0 and not exists(select 1 from public.charges c where c.id=lots.charge_id and c.pix_issue_since is not null and c.status::text in('pending','in_process')) and payment_due_at>now() and payment_due_at<=now()+interval '2 hours' and payment_last_warning_at is null order by payment_due_at,id limit 200 for update skip locked),
 updated as(update public.lots l set payment_last_warning_at=now() from picked p where l.id=p.id returning l.*)
 insert into public.customer_notifications(customer_id,kind,title,body,href,dedupe_key)
 select customer_id,'lot_payment_last_warning','Últimas horas para pagar',count(*)||' lote(s) vencem em até 2 horas. Após o prazo, os arremates não pagos serão cancelados.','/painel/pix','auction_22h:'||(array_agg(id::text order by id))[1] from updated group by customer_id on conflict do nothing;
 get diagnostics extra=row_count;return n+extra;
end $$;
revoke all on function public.notify_auction_payment_deadlines() from public,anon,authenticated;
grant execute on function public.notify_auction_payment_deadlines() to service_role;

create or replace function public.claim_auction_payment_expirations(p_limit integer default 5)
returns table(id uuid,charge_id uuid) language sql security definer set search_path='' as $$
 with picked as(select l.id from public.lots l where l.status='pending_payment' and l.paid_at is null and l.arremate_value>0 and not exists(select 1 from public.charges c where c.id=l.charge_id and c.pix_issue_since is not null and c.status::text in('pending','in_process')) and l.payment_due_at<=now() and (l.payment_expiry_retry_at is null or l.payment_expiry_retry_at<=now()) order by l.payment_due_at,l.id limit least(greatest(p_limit,1),20) for update skip locked)
 update public.lots l set payment_expiry_retry_at=now()+interval '2 minutes' from picked p where l.id=p.id returning l.id,l.charge_id;
$$;
revoke all on function public.claim_auction_payment_expirations(integer) from public,anon,authenticated;
grant execute on function public.claim_auction_payment_expirations(integer) to service_role;


-- Update only the known scheduler condition; preserve its URL, signature and frequency.
do $scheduler$
declare job record; patched text;
begin
 if to_regclass('cron.job') is not null then
  for job in select jobid,command from cron.job where jobname='ocdl-auction-payment-deadlines' loop
   patched:=replace(job.command,
    'where status=''pending_payment'' and arremate_value>0 and payment_due_at is not null',
    'where status=''pending_payment'' and arremate_value>0 and not exists(select 1 from public.charges c where c.id=lots.charge_id and c.pix_issue_since is not null and c.status::text in(''pending'',''in_process'')) and payment_due_at is not null');
   if patched<>job.command then
    patched:=regexp_replace(patched,';[[:space:]]*$','')||' or exists(select 1 from public.charges c where c.status::text in(''pending'',''in_process'') and c.pix_issue_since is not null and c.pix_attempts<4 and (c.pix_last_attempt_at is null or c.pix_last_attempt_at<=now()-interval ''5 minutes''));';
    perform cron.alter_job(job.jobid,command:=patched);
   end if;
  end loop;
 end if;
end;$scheduler$;
commit;
