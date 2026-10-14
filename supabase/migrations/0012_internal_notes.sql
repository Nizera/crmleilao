-- =============================================================================
-- 0012: observações internas saem das tabelas dos clientes
--
-- Problema: a RLS deixa cada cliente ler a LINHA INTEIRA do próprio registro.
-- O painel não pedia a coluna `notes`, mas nada impedia o cliente de rodar
--   supabase.from("lots").select("code, notes")
-- no console do navegador e ler o que a equipe escreveu sobre ele.
--
-- Coluna não resolve: staff e cliente compartilham o papel `authenticated`,
-- então não existe privilégio de coluna que separe os dois. A única correção
-- de verdade é mover a informação para uma tabela com regra de linha própria.
--
-- Os dados são copiados e as colunas antigas são removidas — nada se perde.
-- `charges.notes` e `shipments.notes` nunca foram lidos/escritos pelo app;
-- continuam indo para a tabela por consistência.
-- =============================================================================

-- Idempotente: dá para colar de novo no SQL editor sem quebrar.
do $$
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where t.typname = 'note_entity' and n.nspname = 'public'
  ) then
    create type note_entity as enum ('customer', 'lot', 'charge', 'shipment');
  end if;
end $$;

create table if not exists public.internal_notes (
  id          uuid primary key default gen_random_uuid(),
  entity_type note_entity not null,
  entity_id   uuid not null,
  body        text,
  created_by  uuid references public.admin_profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (entity_type, entity_id)
);

-- Índice da constraint `unique (entity_type, entity_id)` já atende as queries
-- do backfill e da leitura; nenhum índice extra.

drop trigger if exists set_updated_at on public.internal_notes;
create trigger set_updated_at
  before update on public.internal_notes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: o cliente não tem linha em admin_profiles, então is_admin() é false e
-- ele nem vê a tabela. Escrita exige owner/staff (mesmo guard das actions).
-- ---------------------------------------------------------------------------
alter table public.internal_notes enable row level security;

drop policy if exists internal_notes_select_team on public.internal_notes;
create policy internal_notes_select_team on public.internal_notes
  for select to authenticated
  using (public.is_admin());

drop policy if exists internal_notes_insert_team on public.internal_notes;
create policy internal_notes_insert_team on public.internal_notes
  for insert to authenticated
  with check (public.has_staff_write());

drop policy if exists internal_notes_update_team on public.internal_notes;
create policy internal_notes_update_team on public.internal_notes
  for update to authenticated
  using (public.has_staff_write())
  with check (public.has_staff_write());

drop policy if exists internal_notes_delete_team on public.internal_notes;
create policy internal_notes_delete_team on public.internal_notes
  for delete to authenticated
  using (public.has_staff_write());

revoke all on public.internal_notes from public, anon;

-- ---------------------------------------------------------------------------
-- Backfill (idempotente: `on conflict` reescreve se rodar de novo)
-- ---------------------------------------------------------------------------
insert into public.internal_notes (entity_type, entity_id, body, updated_at)
select 'customer', id, notes, updated_at
  from public.customers
 where notes is not null and btrim(notes) <> ''
on conflict (entity_type, entity_id) do update set body = excluded.body;

insert into public.internal_notes (entity_type, entity_id, body, updated_at)
select 'lot', id, notes, updated_at
  from public.lots
 where notes is not null and btrim(notes) <> ''
on conflict (entity_type, entity_id) do update set body = excluded.body;

insert into public.internal_notes (entity_type, entity_id, body, updated_at)
select 'charge', id, notes, updated_at
  from public.charges
 where notes is not null and btrim(notes) <> ''
on conflict (entity_type, entity_id) do update set body = excluded.body;

insert into public.internal_notes (entity_type, entity_id, body, updated_at)
select 'shipment', id, notes, updated_at
  from public.shipments
 where notes is not null and btrim(notes) <> ''
on conflict (entity_type, entity_id) do update set body = excluded.body;

-- ---------------------------------------------------------------------------
-- Remove a coluna que agora é pública para o dono da linha.
-- ---------------------------------------------------------------------------
alter table public.customers drop column if exists notes;
alter table public.lots     drop column if exists notes;
alter table public.charges  drop column if exists notes;
alter table public.shipments drop column if exists notes;
