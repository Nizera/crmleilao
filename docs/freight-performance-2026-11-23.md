# Frete em lote — 23/11/2026

A função shipping_freight_states(uuid[]) consultava várias funções de frete para cada cliente. A implementação agora calcula os conjuntos de clientes com frete disponível, cobrança de frete aberta, lotes elegíveis e frete alocado a um envio ativo uma vez por chamada.

## Regras preservadas

Prioridade: frete disponível pago; pagamento de frete aberto; lote elegível sem envio; frete já alocado a envio pendente/liberado; nenhum.
A elegibilidade continua incluindo arremate com valor ou voucher, exclui isenções e lotes em envio não cancelado. Lotes zerados continuam fora da cobrança, salvo voucher aplicado, como na regra anterior.
Entradas repetidas e nulas mantêm a multiplicidade. Listas vazias/nulas retornam zero linhas.
A assinatura, SECURITY DEFINER, STABLE, search_path vazio, proprietário e permissões anteriores (postgres e service_role) foram preservados. Nenhum lote, cobrança, pagamento ou envio foi alterado.

## Validação

- 149 cadastros comparados com os resultados anteriores.
- 155 casos / 305 linhas: zero divergências entre os resultados e a expressão original baseada nas funções auxiliares.
- Teste repetível em supabase/tests/batch_shipping_freight_states.sql.
- Benchmark: array ordenado dos mesmos clientes; uma execução de aquecimento e cinco execuções de jsonb_agg(to_jsonb(s)) dentro de PL/pgSQL.
- Antes: média 160,031 ms (157,657–164,082 ms).
- Depois: média 5,858 ms (4,939–9,007 ms).
- Redução aproximada: 96,3% no tempo dessa consulta no banco. Não é uma medição de carregamento completo, rede ou navegador.
- O primeiro EXPLAIN da versão antiga levou 417,160 ms, incluindo condições de cache/planejamento diferentes; esse valor não foi usado como base do percentual.
- Outras medições variam com a carga e o plano: não interpretar um único tempo como garantia.

## Manutenção

Ao alterar get_due_freight_periods_before_checkout, get_due_freight_periods ou as regras de disponibilidade/alocação de frete, revisar também esta consulta e executar a regressão.
