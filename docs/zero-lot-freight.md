# Frete automático de lotes zerados

Lotes com `arremate_value = 0` não originam cobrança de frete. O cálculo consulta os lotes atuais: cadastrar um arremate com valor positivo volta a exigir o frete acumulado normal quando não há crédito disponível. A regra também alcança os zerados já cadastrados.

Pacotes compostos apenas por lotes zerados elegíveis, prêmios de rifas pagos e reposições permitidas usam `freight_payer = company`. Não criam pagamentos nem créditos, e não consomem créditos de frete existentes. Compras físicas da loja e lotes de valor positivo mantêm suas regras normais. Pacotes já congelados não são alterados por compras posteriores.

A isenção não confirma pagamentos, não altera status de lotes, não cancela Pix e não reembolsa fretes anteriores. Um lote ainda pendente continua dependendo da conferência da equipe antes do envio. As liberações individuais anteriores são preservadas.

O relatório de separação e a fila de envios reconhecem automaticamente o lote zerado, sem consultar a lista de liberações manuais. Validações de cadastro, pagamentos, estoque, prêmios e conteúdo do pacote permanecem em vigor.

Validação: `scripts/zero-lot-freight.test.mjs` executa as funções SQL reais em PostgreSQL descartável. `scripts/reports.test.mjs` e `scripts/shipment-queue.test.mjs` cobrem separação e fila, incluindo a retirada da isenção após novo arremate.
