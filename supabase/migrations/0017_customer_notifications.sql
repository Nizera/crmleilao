-- =============================================================================
-- 0017: customer_notifications - sino do painel do cliente
-- Aplicar no SQL Editor do Supabase DEPOIS da 0016.
--
-- Idempotente: da para colar de novo sem quebrar.
--
-- O webhook do Mercado Pago (Pix pago/expirado) e o webhook da SuperFrete
-- (envio postado/entregue) gravam linhas aqui via service role. O cliente
-- lê as proprias (RLS) no header do painel e marca como lidas.
--
-- dedupe_key evita duplicar a mesma notificacao quando o webhook reenvia
-- o evento (unique parcial por cliente + chave).
-- =============================================================================

create table if not exists public.customer_notifications (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id)
              on delete cascade,
  kind        text not null,
  title       text not null,
  body        text not null default '',
  -- Deep link dentro do painel (ex.: /painel/pix). Opcional.
  href        text,
  -- Chave de idempotencia (ex.: charge_approved:<id>). Null = sem dedupe.
  dedupe_key  text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

comment on table public.customer_notifications is
  'Notificacoes do sino do painel do cliente. Inseridas pelo backend (webhooks).';
comment on column public.customer_notifications.dedupe_key is
  'Idempotencia por cliente: evento repetido do webhook nao duplica.';

create unique index if not exists customer_notifications_dedupe_idx
  on public.customer_notifications (customer_id, dedupe_key)
  where dedupe_key is not null;

create index if not exists customer_notifications_customer_idx
  on public.customer_notifications (customer_id, created_at desc);

alter table public.customer_notifications enable row level security;

-- Cliente le as proprias; equipe acompanha tudo (debug).
drop policy if exists customer_notifications_select on public.customer_notifications;
create policy customer_notifications_select on public.customer_notifications
  for select to authenticated
  using (
    public.is_admin()
    or customer_id = public.current_customer_id()
  );

-- Cliente so marca como lida (update do read_at); insert/delete so via
-- service role (webhooks) — sem policy de insert.
drop policy if exists customer_notifications_update_self on public.customer_notifications;
create policy customer_notifications_update_self on public.customer_notifications
  for update to authenticated
  using (customer_id = public.current_customer_id())
  with check (customer_id = public.current_customer_id());

-- Cliente nao pode inventar colunas: so read_at.
revoke update on public.customer_notifications from authenticated;
grant update (read_at) on public.customer_notifications to authenticated;
