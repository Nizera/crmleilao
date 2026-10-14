-- =============================================================================
-- 0011: garante customer_invites.token
--
-- A 0007 foi alterada depois de já existir em bancos que já rodaram a versão
-- antiga (sem `token`). Como `create table if not exists` não altera uma tabela
-- existente, a lista de convites pendentes em Configuração falhava com
-- "column customer_invites.token does not exist".
--
-- Idempotente: só cria a coluna se faltar. Linhas antigas ficam com token nulo
-- (o link não pode ser reexibido, mas o token_hash continua válido).
-- =============================================================================

alter table public.customer_invites
  add column if not exists token text;

-- Mesma restrição da 0007: um token só pode existir uma vez.
create unique index if not exists customer_invites_token_key
  on public.customer_invites (token);

comment on column public.customer_invites.token is
  'Token cru da URL. Visível só para o service role (RLS fechada) e listado
   somente para o dono da equipe, para reexibir o link pendente.';
