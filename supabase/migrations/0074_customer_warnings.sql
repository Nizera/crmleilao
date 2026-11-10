-- Sem advertências retroativas. Somente futuros cancelamentos por expiração.
begin;
create table public.customer_access_state (
 customer_id uuid primary key references public.customers(id) on delete cascade,
 warning_count integer not null default 0 check(warning_count between 0 and 3),
 blocked_at timestamptz,
 updated_at timestamptz not null default now()
);
create table public.customer_access_events (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references public.customers(id) on delete cascade,
 kind text not null check(kind in('warning','unblock')),
 reason text not null check(char_length(reason) between 3 and 500),
 source_key text not null unique,
 actor_id uuid,
 created_at timestamptz not null default now()
);
create index customer_access_events_recent on public.customer_access_events(customer_id,created_at desc);
alter table public.customer_access_state enable row level security;
alter table public.customer_access_events enable row level security;
revoke all on public.customer_access_state,public.customer_access_events from anon,authenticated;
grant select on public.customer_access_state,public.customer_access_events to authenticated;
create policy customer_access_read on public.customer_access_state for select to authenticated using(
 public.is_admin() or exists(select 1 from public.customers c where c.id=customer_id and c.auth_user_id=auth.uid())
);
create policy customer_access_events_read on public.customer_access_events for select to authenticated using(public.is_admin());

create function public.record_customer_warning(p_customer uuid,p_key text,p_reason text,p_actor uuid default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 -- Serializa advertências e liberações do mesmo cliente.
 perform 1 from public.customers where id=p_customer for update;
 if not found then raise exception 'Cliente não encontrado.';end if;
 insert into public.customer_access_events(customer_id,kind,reason,source_key,actor_id)
 values(p_customer,'warning',p_reason,p_key,p_actor) on conflict(source_key) do nothing;
 if not found then return;end if;
 insert into public.customer_access_state(customer_id,warning_count) values(p_customer,0) on conflict do nothing;
 update public.customer_access_state set warning_count=least(warning_count+1,3),
 blocked_at=case when warning_count+1>=3 then coalesce(blocked_at,now()) else blocked_at end,updated_at=now()
 where customer_id=p_customer;
end $$;
revoke all on function public.record_customer_warning(uuid,text,text,uuid) from public,anon,authenticated;

create function public.warn_expired_customer_lot() returns trigger language plpgsql security definer set search_path='' as $$
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
create trigger customer_warning_after_lot_expiry after update of status,payment_expired_at on public.lots
for each row execute function public.warn_expired_customer_lot();

create function public.manage_customer_access(p_customer uuid,p_request uuid,p_action text,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.admin_profiles where id=auth.uid() and role in('owner','staff')) then raise exception 'Acesso negado.' using errcode='42501';end if;
 if p_request is null or p_reason is null or char_length(trim(p_reason)) not between 3 and 500 or p_action not in('warning','unblock') or p_action is null then raise exception 'Informe uma ação e um motivo válido.';end if;
 perform 1 from public.customers where id=p_customer for update;
 if not found then raise exception 'Cliente não encontrado.';end if;
 if exists(select 1 from public.customer_access_events where source_key='admin:'||p_request::text) then return;end if;
 if p_action='warning' then
  perform public.record_customer_warning(p_customer,'admin:'||p_request::text,trim(p_reason),auth.uid());
 else
  if not exists(select 1 from public.customer_access_state where customer_id=p_customer and (blocked_at is not null or warning_count>0)) then raise exception 'Cliente sem advertências ativas.';end if;
  insert into public.customer_access_events(customer_id,kind,reason,source_key,actor_id) values(p_customer,'unblock',trim(p_reason),'admin:'||p_request::text,auth.uid());
  update public.customer_access_state set warning_count=0,blocked_at=null,updated_at=now() where customer_id=p_customer;
 end if;
end $$;
revoke all on function public.manage_customer_access(uuid,uuid,text,text) from public,anon;
grant execute on function public.manage_customer_access(uuid,uuid,text,text) to authenticated;

-- Bloqueia também RPCs e leituras privadas por sessões já abertas.
create or replace function public.current_customer_id() returns uuid language sql stable security definer set search_path='' as $$
 select c.id from public.customers c where c.auth_user_id=auth.uid()
 and not exists(select 1 from public.customer_access_state a where a.customer_id=c.id and a.blocked_at is not null) limit 1
$$;
commit;
