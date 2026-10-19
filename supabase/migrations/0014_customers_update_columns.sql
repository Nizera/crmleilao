-- =============================================================================
-- 0014: customers - quais colunas o UPDATE por sessao pode tocar
-- Aplicar no SQL Editor do Supabase DEPOIS da 0013_hardening.sql.
--
-- Idempotente: da para colar de novo sem quebrar.
--
-- A policy customers_update_self_or_admin (0009) controla QUEM atualiza a
-- linha: o proprio cliente (auth_user_id = auth.uid()) ou staff
-- (has_staff_write()). Ela nao controla quais colunas: RLS enxerga a linha
-- nova, nao a antiga, entao nenhuma policy impede um UPDATE de trocar uma
-- coluna especifica.
--
-- Sem grants de coluna, qualquer cliente logado chamava a API direta com
--     update public.customers set phone_e164 = ... / auth_user_id = ...
-- trocando o telefone do cadastro ou o vinculo da conta (os dois alimentam
-- convites e login). Com o revoke abaixo esse UPDATE falha com permission
-- denied ANTES de chegar na RLS - camada dupla.
--
-- Ninguem legitimo e afetado:
--   * service role (createAdminClient) mantem todos os grants: convites,
--     acceptCustomerInvite e o trigger de auth.users gravam auth_user_id;
--   * INSERT nao e revogado (o admin cria cliente com phone_e164 via
--     sessao; a policy ja exige staff);
--   * o unico UPDATE autenticado que gravava phone_e164 era o saveCustomer
--     do admin - o codigo passou a usar o admin client junto com esta
--     migracao (guard requireAdmin() roda antes da query);
--   * cadastro do cliente (profile) e update de nome (lots) usam apenas as
--     10 colunas da lista.
--
-- updated_at fica de fora de proposito: o trigger set_updated_at() (0001)
-- escreve a coluna dentro da chamada do trigger, fora do SET da instrucao,
-- e nao exige grant do chamador.
-- =============================================================================

revoke update on public.customers from anon, authenticated;

grant update (
  name, email, cpf_cnpj,
  address_cep, address_street, address_number, address_complement,
  address_district, address_city, address_state
) on public.customers to authenticated;
