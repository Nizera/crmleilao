-- =============================================================================
-- 0013: hardening de acabamento
-- Aplicar no SQL Editor do Supabase DEPOIS da 0012_internal_notes.sql.
--
-- Idempotente: da para colar de novo sem quebrar.
--
-- 1. app_secrets sem privilegio para anon/authenticated.
--    A 0009 ligou a RLS (sem policy = nenhuma linha visivel), mas nao tirou o
--    GRANT de tabela que o Supabase da por padrao. Camada dupla: se um dia
--    alguem criar uma policy por engano, a linha continua inacessivel sem
--    tambem reconceder SELECT. O service_role nao e afetado — e o unico
--    caminho que o app usa (createAdminClient()).
--
-- 2. Indice parcial de convites pendentes.
--    JA EXISTE desde a 0007_customer_invites.sql
--    (`customer_invites_pending_idx` em (created_at desc) where used_at is
--    null). Nao e criado aqui de novo: dois indices identicos so custariam
--    escrita. A RPC de diagnostico abaixo apenas confirma que ele continua
--    de pe — se sumir, listPendingInvites volta a fazer seq scan.
--
-- NAO mexe em funcoes existentes: `set search_path = ''` exige que o chamador
-- seja dono da funcao e pode falhar com "must be owner of function" no SQL
-- Editor. O ganho ali e baixo (nenhuma dessas funcoes cria objeto em public).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Revoga privilegio de tabela (a RLS da 0009 continua valendo).
-- ---------------------------------------------------------------------------
revoke all on public.app_secrets from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Diagnostico: privilegio e existencia de indice nao aparecem no
--    PostgREST, entao a migração expoe uma RPC so de service_role que devolve
--    booleans (nenhum valor sensivel). E o que o script
--    scripts/verify-migrations.mjs consulta.
-- ---------------------------------------------------------------------------
create or replace function public.hardening_status()
returns table (check_name text, check_ok boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select 'app_secrets_no_select_authenticated',
         not pg_catalog.has_table_privilege(
           'authenticated', 'public.app_secrets', 'SELECT')
  union all
  select 'app_secrets_no_select_anon',
         not pg_catalog.has_table_privilege(
           'anon', 'public.app_secrets', 'SELECT')
  union all
  select 'customer_invites_pending_idx',
         exists (
           select 1
           from pg_catalog.pg_indexes
           where schemaname = 'public'
             and tablename = 'customer_invites'
             and indexname = 'customer_invites_pending_idx'
         );
$$;

revoke execute on function public.hardening_status() from public, anon, authenticated;
grant  execute on function public.hardening_status() to service_role;
