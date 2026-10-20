-- ===========================================================================
-- F6 — Frete da semana: cobrança fixa (R$ 20) por período de terça a terça
-- Aplicar no SQL Editor do Supabase ou via `supabase db push`,
-- DEPOIS das migrações 0001…0014.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- charges — parte do frete semanal embutida na cobrança Pix
--   amount já passa a ser lotes + freight_amount.
-- ---------------------------------------------------------------------------
alter table public.charges
  add column if not exists freight_amount numeric(10,2) not null default 0
    check (freight_amount >= 0),
  add column if not exists freight_period date;

comment on column public.charges.freight_amount is
  'Parte da cobrança referente ao frete fixo da semana (WEEKLY_FREIGHT). 0 = sem frete.';
comment on column public.charges.freight_period is
  'Início (terça) do período do frete cobrado por esta cobrança.';

-- Só pode existir UMA cobrança de frete por cliente/período enquanto estiver
-- viva (pending/in_process/approved). Cancelada/expirada/recusada libera a
-- vaga para o cliente gerar outro Pix. Também cobre a corrida de duas
-- requisições simultâneas tentando cobrar o frete do mesmo período.
create unique index if not exists charges_freight_period_uidx
  on public.charges (customer_id, freight_period)
  where freight_amount > 0 and status in ('pending', 'in_process', 'approved');

create index if not exists charges_freight_period_idx
  on public.charges (freight_period)
  where freight_amount > 0;
