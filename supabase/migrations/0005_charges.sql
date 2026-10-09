-- ===========================================================================
-- F3 — Cobranças Pix (Mercado Pago): agrupa N lotes de um cliente em 1 Pix
-- Aplicar no SQL Editor do Supabase ou via `supabase db push`,
-- DEPOIS das migrações 0001 a 0004.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Enum de status da cobrança (espelha os status relevantes do Mercado Pago)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'charge_status') then
    create type charge_status as enum (
      'pending',     -- Pix criado, aguardando pagamento
      'in_process',  -- MP processando (raro no Pix)
      'approved',    -- pago — libera os lotes para paid
      'cancelled',   -- cancelada pela equipe
      'expired',     -- passou da data de expiração sem pagamento
      'rejected'     -- MP recusou/estornou
    );
  end if;
end $$;

comment on type charge_status is
  'Ciclo de vida da cobrança Pix. approved = pagamento confirmado no Mercado Pago.';

-- ---------------------------------------------------------------------------
-- charges — uma cobrança Pix por cliente, cobrindo 1..N lotes
--   external_reference é o que volta do webhook do MP (sem ele, o webhook
--   não consegue localizar a cobrança).
-- ---------------------------------------------------------------------------
create table if not exists public.charges (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique
                     default 'C' || upper(encode(gen_random_bytes(4), 'hex')),
  customer_id        uuid not null references public.customers (id)
                     on delete restrict,
  amount             numeric(10,2) not null check (amount > 0),
  status             charge_status not null default 'pending',
  mp_payment_id      text,
  external_reference text not null unique
                     default 'chg_' || gen_random_uuid()::text,
  description        text,
  qr_code            text,
  qr_code_base64     text,
  ticket_url         text,
  expires_at         timestamptz,
  paid_at            timestamptz,
  notes              text,
  created_by         uuid references public.admin_profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.charges is
  'Cobrança Pix (Mercado Pago) agrupando N lotes de um cliente. 1 Pix = 1 cobrança.';
comment on column public.charges.code is
  'Código curto exibido ao admin, ex: C1A2B3C4.';
comment on column public.charges.external_reference is
  'Referência enviada ao Mercado Pago; o webhook devolve para localizar a cobrança.';
comment on column public.charges.mp_payment_id is
  'id numérico do pagamento no MP (guardado como texto).';
comment on column public.charges.qr_code is
  'Pix copia e cola (string BR Code).';
comment on column public.charges.qr_code_base64 is
  'PNG do QR Code em base64 puro (sem o prefixo data:).';
comment on column public.charges.expires_at is
  'date_of_expiration enviado ao MP. Passou daqui e ainda pending = expirada localmente.';

create index if not exists charges_customer_id_idx on public.charges (customer_id, created_at desc);
create index if not exists charges_status_idx      on public.charges (status);
create index if not exists charges_created_at_idx  on public.charges (created_at desc);

drop trigger if exists charges_set_updated_at on public.charges;
create trigger charges_set_updated_at
  before update on public.charges
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- lots.charge_id — cobrança que cobre este lote
-- Lote elegível para nova cobrança = pending_payment e cobrança nula ou com
-- status cancelled/expired/rejected.
-- ---------------------------------------------------------------------------
alter table public.lots
  add column if not exists charge_id uuid references public.charges (id)
    on delete set null;

comment on column public.lots.charge_id is
  'Cobrança que cobre este lote. Pendente de pagamento = charge ativa (pending/in_process).';

create index if not exists lots_charge_id_idx on public.lots (charge_id);

-- ---------------------------------------------------------------------------
-- RLS — equipe lê/escreve; cliente lê as próprias cobranças.
-- Escrita pelo cliente (auto-atendimento no painel) acontece via service role
-- no server action, que valida a posse dos lotes antes.
-- ---------------------------------------------------------------------------
alter table public.charges enable row level security;

drop policy if exists charges_select on public.charges;
create policy charges_select on public.charges
  for select to authenticated
  using (
    public.is_admin()
    or customer_id = public.current_customer_id()
  );

drop policy if exists charges_insert_admin on public.charges;
create policy charges_insert_admin on public.charges
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists charges_update_admin on public.charges;
create policy charges_update_admin on public.charges
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Sem policy de delete: cancelamento muda o status, nada é apagado.
