-- ===========================================================================
-- Convite de acesso ao painel do cliente (link mágico + senha, sem OTP)
-- Aplicar no SQL Editor do Supabase ou via `supabase db push`,
-- DEPOIS das migrações 0001…0006.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- customer_invites — um link por cliente, uso único, expira em 7 dias
-- ---------------------------------------------------------------------------
create table if not exists public.customer_invites (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id)
              on delete cascade,
  token_hash  text not null unique,        -- sha256 do token (nunca o token cru)
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '7 days'),
  used_at     timestamptz,
  constraint customer_invites_hash_len check (char_length(token_hash) = 64)
);

create index if not exists customer_invites_customer_idx
  on public.customer_invites (customer_id, created_at desc);

comment on table public.customer_invites is
  'Convites de acesso ao painel do cliente: link com token (sha256), uso único, expira em 7 dias. Gerado pelo admin; definido o link o cliente cria a senha e a conta auth fica vinculada em customers.auth_user_id.';

-- ---------------------------------------------------------------------------
-- RLS fechada de propósito: sem policy de leitura/escrita — só o service
-- role (server actions) mexe na tabela.
-- ---------------------------------------------------------------------------
alter table public.customer_invites enable row level security;
