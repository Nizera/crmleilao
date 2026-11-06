# Cancelamento da loja e pagamento dos lotes

Requer `0061_store_cancellation_and_auction_payments.sql` antes da publicação.

## Comportamento

- Uma compra da loja pendente não bloqueia o Pix dos lotes. O frete reservado nessa compra não é cobrado novamente.
- Se a compra for cancelada sem pagar o frete, o frete volta a ficar devido; a etiqueta continua exigindo pagamento confirmado.
- O cancelamento pertence ao cliente autenticado e tem limite próprio, independente do checkout e das consultas automáticas.
- O pedido registra a intenção de cancelar. Atualização do cliente e conciliação existente retomam a mesma solicitação após falhas de comunicação.
- Nunca libera estoque, voucher ou Caracoins apenas porque o relógio venceu ou um POST foi enviado. Confere referência, valor e situação na API autenticada.
- Pagamento confirmado durante a solicitação é conciliado como pago; não é reembolsado automaticamente.
- Pedido novo cujo Pix comprovadamente não começou pode ser cancelado localmente. Transação e bloqueio de linha tornam a liberação idempotente.
- Checkout antigo/piloto não usa essa liberação antecipada. A versão gerenciada é marcada pelo novo RPC de checkout; ID perdido exige recuperação idempotente e confirmação do provedor. Isso protege também o intervalo entre migration e deploy.

## Validação

Testes descartáveis com PGlite: permissões, isolamento, repetição, estoque, voucher, Caracoins, frete único, pagamento de lotes com loja pendente, bloqueio de etiqueta sem frete pago e compatibilidade durante rollout.

Testes com provedor simulado: Pix em processamento, pagamento simultâneo ao cancelamento, resposta divergente, cancelamento sem confirmação, ID perdido e cancelamento anterior à primeira tentativa.

Não foram criados, cancelados nem pagos Pix reais nos testes. A consulta do pedido relatado foi somente leitura: provedor encerrado por expiração.
