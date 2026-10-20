-- =============================================================================
-- 0016: staff_payments - registro do pagamento diario a cada membro da equipe
-- Aplicar no SQL Editor do Supabase DEPOIS da 0014 e da 0015_freight.sql.
--
-- Idempotente: da para colar de novo sem quebrar.
--
-- Alimenta o card "Fechamento do dia" do dashboard: mostra quem ja foi pago
-- hoje e quem ainda falta. O valor e digitado a mao (sem regra automatica) e
-- o registro e 1 por pessoa por dia (unique staff_id + payment_date).
--
-- Dado sensivel de remuneracao: a policy so deixa o dono (is_owner()) ler e
-- escrever; staff e viewer nao enxergam a tabela. As actions do app tambem
-- checam o papel antes (camada dupla).
-- =============================================================================

create table if not exists public.staff_payments (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid not null references public.admin_profiles (id)
               on delete cascade,
  payment_date date not null default current_date,
  amount       numeric(10,2) not null check (amount >= 0),
  notes        text,
  created_by   uuid references public.admin_profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (staff_id, payment_date)
);

comment on table public.staff_payments is
  'Fechamento diario: pagamento registrado a um membro da equipe (1 por dia).';
comment on column public.staff_payments.amount is
  'Valor digitado no fechamento do dia (manual, sem regra automatica).';
comment on column public.staff_payments.payment_date is
  'Dia do fechamento (AAAA-MM-DD). Um registro por staff por dia.';

create index if not exists staff_payments_date_idx
  on public.staff_payments (payment_date desc);

drop trigger if exists staff_payments_set_updated_at on public.staff_payments;
create trigger staff_payments_set_updated_at
  before update on public.staff_payments
  for each row execute function public.set_updated_at();

alter table public.staff_payments enable row level security;

drop policy if exists staff_payments_owner on public.staff_payments;
create policy staff_payments_owner on public.staff_payments
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- Remuneracao nao e dado de staff: anon nunca passa por aqui.
revoke all on public.staff_payments from anon;
