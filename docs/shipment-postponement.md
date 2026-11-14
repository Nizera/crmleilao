# Adiar envio de um cliente

Em Envios, nos três pontinhos de um registro ainda sem etiqueta, selecionar **Adiar envio**.
A próxima terça é sugerida. A nova data deve ser posterior à original e não pode estar no passado.

A confirmação altera somente `shipping_date` dos lotes pagos ou pendentes daquele cliente e daquela data, sem etiqueta ativa. Não altera status, valores, cobrança, prazo de 24 horas, movimentação física ou estoque.
A opção adicional inclui prêmios e reposições não cancelados e ainda sem vínculo com etiqueta. Pedidos da loja não são alterados.

A operação ocorre em uma transação, usando a mesma trava por cliente do vínculo de conteúdo das etiquetas, e registra os IDs afetados, datas e administrador em `shipping_postponements`. Clientes, visitantes e perfis de somente leitura não podem executar a operação. A tabela de auditoria não é exposta via API pública.

## Banco
Executar **supabase/migrations/0084_postpone_customer_shipping.sql** antes de usar. A aplicação da migration não adia nenhum item; só cria a função e o histórico.

## Validação
`node --test scripts/shipment-postponement.test.mjs`: verifica isolamento de cliente e data, itens com etiqueta ativa, reutilização após etiqueta cancelada, preservação de cobrança, prazo e movimentação, datas inválidas, falta de permissão, repetição e itens logísticos opcionais. Os testes usam banco isolado e não alteram produção.
