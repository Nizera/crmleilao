-- ===========================================================================
-- F0 — Base: clientes, administradores, vínculo OTP e RLS
-- Aplicar no SQL Editor do Supabase ou via `supabase db push`.
-- ===========================================================================

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Enum de papel da equipe
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'admin_role') then
    create type admin_role as enum ('owner', 'staff', 'viewer');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- admin_profiles — equipe que acessa /admin
-- A escrita NÃO tem policy: só service role ou funções SECURITY DEFINER.
-- ---------------------------------------------------------------------------
create table if not exists public.admin_profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text,
  role       admin_role not null default 'staff',
  created_at timestamptz not null default now()
);

comment on table public.admin_profiles is
  'Equipe interna. Uma linha por usuário autenticado de e-mail/senha.';

-- ---------------------------------------------------------------------------
-- customers — clientes do leilão, identificados pelo WhatsApp
-- ---------------------------------------------------------------------------
create table if not exists public.customers (
  id             uuid primary key default gen_random_uuid(),
  phone_e164     text not null unique
                 check (phone_e164 ~ '^\+[1-9]\d{10,14}$'),
  name           text,
  email          text,
  cpf_cnpj       text,
  auth_user_id   uuid unique references auth.users (id) on delete set null,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on column public.customers.phone_e164 is 'WhatsApp em E.164, ex: +5511999998888.';
comment on column public.customers.auth_user_id is
  'Preenchido no primeiro login por OTP. NULL = cliente ainda nunca entrou.';

create index if not exists customers_name_trgm_idx
  on public.customers using gin (coalesce(name, '') gin_trgm_ops);

create index if not exists customers_created_at_idx
  on public.customers (created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Vínculo automático: primeiro login por OTP cria/conecta o customer
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer public.customers%rowtype;
begin
  if new.phone is null then
    return new;
  end if;

  -- Já existe cadastro feito pelo admin (sem login ainda)? Conecta.
  select * into v_customer
  from public.customers
  where phone_e164 = new.phone
  for update;

  if found then
    if v_customer.auth_user_id is null then
      update public.customers
      set auth_user_id = new.id
      where id = v_customer.id;
    end if;
    return new;
  end if;

  -- Primeira vez: cria o cliente já vinculado.
  begin
    insert into public.customers (phone_e164, auth_user_id)
    values (new.phone, new.id)
    on conflict (phone_e164) do nothing;
  exception when unique_violation then
    null;
  end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- Helpers de autorização
-- ---------------------------------------------------------------------------

-- Cliente dono da sessão atual (ou null).
create or replace function public.current_customer_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id
  from public.customers c
  where c.auth_user_id = auth.uid()
  limit 1;
$$;

-- true quando o usuário logado faz parte da equipe.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_profiles where id = auth.uid()
  );
$$;

-- true quando o usuário logado é dono da equipe.
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_profiles
    where id = auth.uid() and role = 'owner'
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.admin_profiles enable row level security;
alter table public.customers enable row level security;

-- admin_profiles: leitura do próprio perfil (necessário para o guard de rota).
drop policy if exists admin_profiles_select_own on public.admin_profiles;
create policy admin_profiles_select_own on public.admin_profiles
  for select to authenticated
  using (id = auth.uid());

-- admin_profiles: dono lê a equipe inteira.
drop policy if exists admin_profiles_select_owner on public.admin_profiles;
create policy admin_profiles_select_owner on public.admin_profiles
  for select to authenticated
  using (public.is_owner());

-- Sem policy de insert/update/delete: só service role ou funções definer.
-- Isso impede que qualquer usuário autenticado se promova a admin.

-- customers: o próprio cliente enxerga a si; a equipe enxerga todos.
drop policy if exists customers_select_self_or_admin on public.customers;
create policy customers_select_self_or_admin on public.customers
  for select to authenticated
  using (auth_user_id = auth.uid() or public.is_admin());

drop policy if exists customers_update_self_or_admin on public.customers;
create policy customers_update_self_or_admin on public.customers
  for update to authenticated
  using (auth_user_id = auth.uid() or public.is_admin())
  with check (auth_user_id = auth.uid() or public.is_admin());

-- Inclusão: apenas a equipe (o gatilho de OTP roda como definer e contorna).
drop policy if exists customers_insert_admin on public.customers;
create policy customers_insert_admin on public.customers
  for insert to authenticated
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Bootstrap do primeiro administrador.
-- Executar UMA vez no SQL Editor, trocando o e-mail:
--   select public.add_admin('voce@exemplo.com', 'owner', 'Nome');
-- ---------------------------------------------------------------------------
create or replace function public.add_admin(
  p_email text,
  p_role  admin_role default 'owner',
  p_name  text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  select id into v_user_id
  from auth.users
  where lower(email) = lower(p_email)
  limit 1;

  if v_user_id is null then
    raise exception 'Nenhum usuário com o e-mail % — crie a conta no painel do Supabase (Authentication > Users) antes.', p_email;
  end if;

  insert into public.admin_profiles (id, name, role)
  values (v_user_id, p_name, p_role)
  on conflict (id) do update set name = excluded.name, role = excluded.role;

  return v_user_id;
end;
$$;

revoke all on function public.add_admin(text, admin_role, text) from public;
grant execute on function public.add_admin(text, admin_role, text) to service_role;
