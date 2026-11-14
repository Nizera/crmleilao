# Entrega própria por motoboy

1. Aplicar `supabase/migrations/0085_local_deliveries.sql`.
2. Em Envios, selecionar a data e abrir os três pontinhos do pacote sem etiqueta.
3. Escolher **Registrar entrega por motoboy**, conferir endereço e itens, preencher uma observação opcional e **Confirmar saída**.
4. A saída usa o frete aprovado disponível na mesma transação que vincula os itens e os marca como enviados. Novos arremates sem outro crédito disponível geram novo frete de R$20. Não é necessário esperar a conclusão da entrega.
5. Em **Gerenciar entrega**, marcar entregue depois da confirmação do motoboy.

A função não cria pedidos, cobranças ou etiquetas na SuperFrete. `sf_order_id` fica nulo, com modalidade explicitamente registrada. As consultas automáticas de custo e ações de transportadora ignoram essas entregas.

Os mesmos bloqueios financeiros e verificações de conteúdo da emissão se aplicam. Prêmios e reposições disponíveis até a data do pacote seguem as regras existentes; pedidos físicos da loja precisam estar separados. Lotes podem ser selecionados no formulário. A observação é exibida ao cliente; não incluir informação interna nela.

Cancelar uma saída ainda não entregue exige confirmação de retorno do pacote. Os lotes voltam a pagos; vínculos da loja e itens logísticos são liberados, preservando movimentações. O crédito de frete fica disponível novamente. A entrega cancelada e seu conteúdo permanecem no histórico. Entrega concluída não pode ser cancelada por esse fluxo.

Segurança: apenas equipe com escrita; função transacional; trava por cliente; chave de repetição única; conferência de cliente, valores e disponibilidade; snapshot de conteúdo e destinatário; eventos com data e responsável. Operações financeiras existentes são reutilizadas, sem marcação fictícia de pagamento. A aplicação da migration não cria ou movimenta entregas existentes.

Validação isolada em `scripts/local-deliveries.test.mjs`: consumo do crédito na saída, nova cobrança para novos arremates, bloqueio de frete/lote não pago, repetição, permissão, entrega, cancelamento, itens logísticos e impedimento de chamadas SuperFrete. Testes não alteram dados de produção.
