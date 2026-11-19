# Voucher de rifa nos lotes do leilão

Ao encerrar uma campanha com bônus de maior comprador do tipo voucher, o ganhador recebe automaticamente crédito exclusivo do leilão. O resultado é marcado como entregue porque o crédito foi disponibilizado; isso não registra receita nem pagamento Pix. Prêmios antigos já confirmados manualmente não são reemitidos. Prêmios pendentes elegíveis são migrados uma única vez.

No cadastro/edição do lote, selecione o cliente na busca. O bloco amarelo **Voucher do cliente** mostra os créditos, o valor disponível para esse cadastro e quanto usar. Ao salvar, o crédito fica vinculado ao lote. O resumo e a listagem identificam o desconto por voucher. A edição soma o crédito deste próprio lote ao saldo utilizável, sem liberar valores reservados em outros lotes.

O lote guarda valor líquido (`arremate_value`), desconto total (`discount_amount`) e sua parcela de voucher (`voucher_amount`). O valor original é líquido + desconto total. O saldo e os movimentos do voucher são atualizados na mesma transação do lote, com bloqueio dos créditos envolvidos. Cancelar um lote elegível devolve o crédito; reabrir exige saldo novamente. Alterações de Pix, lotes pagos ou movimentados seguem as proteções financeiras existentes.

Se o voucher cobrir todo o lote, ele fica quitado sem criar Pix ou recebimento de R$ 0. Esse arremate continua sujeito ao frete normal. Ele nunca é confundido com prêmio/reposição zerada nem cria crédito de frete. Desconto e voucher não podem superar o valor original. O saldo remanescente fica para outros lotes.

O dashboard separa valor original, vouchers, outros descontos e receita após descontos, sem frete. Os recebimentos confirmados continuam mostrando somente dinheiro recebido. Vouchers da loja e Caracoins são independentes deste crédito.

No painel do cliente, Rifas → Meus prêmios mostra o saldo disponível e orienta a solicitar aplicação à equipe. Alterações nos pagamentos da rifa que coloquem o resultado em revisão bloqueiam novas utilizações; não reatribuem silenciosamente créditos já usados.

Testes: `scripts/auction-vouchers.test.mjs`, `scripts/lot-discount.test.mjs` e `scripts/analytics.test.mjs`, além das regressões de loja, rifa, frete e edição financeira.
