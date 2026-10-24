-- =============================================================================
-- 0018: balance_transactions - saldo/carteira do cliente (ledger)
-- Aplicar no SQL Editor do Supabase DEPOIS da 0017.
--
-- Idempotente: da para colar de novo sem quebrar.
--
-- Ledger append-only: saldo = sum(amount). Positivo = credito, negativo =
-- debito. Por enquanto so a equipe lanca (manual, no detalhe do cliente);
-- no futuro a loja vai gravar creditos automaticos por aqui tambem.
--
-- O cliente le as proprias linhas e a soma (RLS); a equipe le e escreve
-- (has_staff_write). Insert direto do cliente NAO existe.
-- =============================================================================

create table if not exists public.balance_transactions (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id)
              on delete cascade,
  -- Positivo credita, negativa debita. Nunca zero.
  amount      numeric(10,2) not null check (amount <> 0),
  -- 'manual' (equipe), no futuro: 'store', 'refund' etc.
  kind        text not null default 'manual',
  note        text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

comment on table public.balance_transactions is
  'Ledger de saldo do cliente. Append-only; saldo = sum(amount).';
comment on column public.balance_transactions.amount is
  'Credito (+) ou debito (-) em BRL. Lancado pela equipe ou, no futuro, pela loja.';

create index if not exists balance_transactions_customer_idx
  on public.balance_transactions (customer_id, created_at desc);

alter table public.balance_transactions enable row level security;

-- Cliente le o proprio ledger (extrato + soma no header); equipe le tudo.
drop policy if exists balance_transactions_select on public.balance_transactions;
create policy balance_transactions_select on public.balance_transactions
  for select to authenticated
  using (
    public.is_admin()
    or customer_id = public.current_customer_id()
  );

-- Escrita: so equipe (owner/staff). Sem policy de delete: ledger nao apaga.
drop policy if exists balance_transactions_insert_staff on public.balance_transactions;
create policy balance_transactions_insert_staff on public.balance_transactions
  for insert to authenticated
  with check (public.has_staff_write());
