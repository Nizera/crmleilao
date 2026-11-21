# Caracoins nas rifas

Compras de cotas pagas seguem a taxa de crédito do leilão. O valor considerado é `raffle_orders.amount`, já líquido de descontos comerciais e sem subtrair novamente descontos nem taxas do provedor.

| Pontuação antes do crédito | Caracoins por R$ 1 |
| --- | --- |
| Menor que 1.000 | 0,5 |
| De 1.000 até antes de 5.000 | 1 |
| De 5.000 até antes de 15.000 | 1,5 |
| De 15.000 até antes de 25.000 | 2 |
| De 25.000 até antes de 50.000 | 2,5 |
| A partir de 50.000 | 3 |

A pontuação combina o histórico de ranking com créditos e estornos, exatamente como no leilão. Gastos e expirações não reduzem o elo. O crédito de rifa participa do ranking. Não cria um novo bônus de boas-vindas de 500 moedas: esse benefício continua no fluxo do leilão.

- A confirmação `paid` cria um crédito identificado pelo pedido; o extrato informa a campanha e o código do pedido.
- Índice único por pedido/tipo impede repetição de crédito e de estorno, inclusive por confirmação reenviada.
- Pedidos pendentes, expirados, cancelados ou em análise não ganham moedas. Sair de `paid` reverte o crédito já gerado, incluindo `review` (benefício retido enquanto o pagamento é conferido).
- Após um estorno, retornar o pedido a `paid` não concede um segundo benefício automaticamente. Uma correção deve ser auditada pela equipe.
- Cliente, campanha e valor ficam protegidos após o crédito, para não transferir ou recalcular pontos silenciosamente.
- Validade é a mesma do leilão: 90 dias a partir do crédito. A guarda de expiração vigente continua responsável por definir o vencimento.
- Estornos de créditos que já expiraram recebem a mesma compensação monetária do leilão, mantendo o estorno integral no elo e evitando uma segunda dívida.
- Créditos não são recalculados quando o cliente sobe de elo.

## Retroativo

O SQL `supabase/releases/raffle_caracoins_backfill.sql` processa pedidos já pagos por data de pagamento e UUID. Parte da pontuação atual de cada cliente, aplica a taxa antes de cada crédito e considera a progressão durante o processamento. Não reconstrói um elo histórico que não foi registrado naquela compra. Os créditos retroativos recebem 90 dias a partir da concessão.

O processamento não modifica pedidos, dados anteriores do extrato ou Caracoins já utilizados. Confere as versões serializadas dos lançamentos anteriores e aborta toda a operação se algum deles mudar. Pode ser repetido sem duplicar créditos. Novos pagamentos usam o gatilho, sem depender de repetir o retroativo.

As funções de crédito são privadas, sem execução direta pelo cliente ou `service_role`; os gatilhos e a operação administrativa de implantação são responsáveis pelos lançamentos. As políticas de leitura do extrato não foram alteradas.

## Testes

`node --test scripts/raffle-caracoins.test.mjs scripts/caracoins-policy.test.mjs`

Incluem todas as faixas de elo, valor líquido, confirmação repetida, retroativo repetido, débito anterior preservado, cancelamento, revisão, compensação de moedas expiradas, validade de 90 dias e execução privada. Não dependem de dados de produção.
