# Separação e valor individual opcionais

- Prêmios de rifa e reposições da data prevista do pacote podem ser incluídos na etiqueta sem movimentação prévia no relatório.
- A emissão não registra uma movimentação física fictícia. Os itens são vinculados ao envio, mantendo o histórico original.
- Movimentar prêmios no relatório aceita valor zero; o campo em reais é opcional. Reposições continuam sem exigir valor.
- O valor total declarado pode ser informado na emissão. Se a soma dos itens for zero, é necessário informar um valor positivo nessa etapa para a SuperFrete.
- Continuam obrigatórios: dados do destinatário, pagamento dos lotes e do frete, pagamento válido do prêmio e declaração compatível com o conteúdo do pacote.
- Não muda a data prevista, não inclui itens cancelados ou de outra data futura, não modifica valores de lotes e não afeta os pagamentos.
- Pedidos da loja mantêm suas regras de separação.

Executar `supabase/migrations/0076_optional_logistics_separation.sql` antes de publicar o código. A migration substitui as validações de separação e valor individual, preservando os bloqueios financeiros e as permissões existentes.

Validação: `node --test scripts/optional-logistics-separation.test.mjs scripts/manual-shipment-declaration.test.mjs scripts/raffle-shipping.test.mjs scripts/shipment-content.test.mjs`.
