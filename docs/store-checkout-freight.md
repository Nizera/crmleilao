# Frete no checkout da loja

Requer a migration 0041, após as migrations anteriores. Não abre a loja nem altera valores de Pix já gerados.

- Carrinho físico consulta o frete do cliente ao abrir. Sem resposta válida, a confirmação fica desabilitada.
- Frete aprovado e ainda disponível, pago nos lotes ou na loja: não cobra novamente.
- Sem crédito disponível: inclui R$ 20 no mesmo Pix da compra. Produtos em Caracoins continuam custando somente moedas; apenas o frete é pago em reais.
- Frete com pagamento pendente ou em análise: aponta o pagamento existente e bloqueia uma segunda cobrança.
- Vouchers descontam somente os produtos. R$ 80 − R$ 10 + R$ 20 de frete = Pix de R$ 90.
- Se o voucher cobrir todos os produtos, ainda será gerado Pix para o frete quando devido. Com frete disponível, não gera Pix de zero.
- O banco recalcula e compara o frete com o valor apresentado no carrinho. Mudança de crédito exige nova confirmação, sem criar cobrança com valor surpresa.
- O crédito do frete é consumido por um único envio. Cancelar etiqueta permite reaproveitá-lo; cancelamento/estorno de pagamento não confirmado não gera crédito disponível.
- Frete aparece separado dos produtos no pedido e nos indicadores. Não entra no faturamento dos produtos nem no valor declarado da mercadoria.
- Compra física com pagamento pendente ou em análise bloqueia emissão do pacote, evitando consumir o crédito enquanto o novo pedido não está regularizado.

Pedidos antigos que não incluíram frete preservam o Pix original e usam a cobrança avulsa da área Pix quando necessária. Os novos checkouts usam a cobrança integrada.

Validação automatizada em banco descartável cobre cupom, crédito de leilão/loja, idempotência, mudança de frete, pagamento pendente, cancelamento, reaproveitamento, produtos em moedas e métricas sem frete. Não houve emissão ou pagamento real nesta implementação.
