# Data de envio dos premios e relatorio

Sem data explicita na campanha, o premio estava recebendo a data da conquista. Sete premios conquistados em 19/11/2026 apareciam no relatorio desse dia, embora o proximo envio fosse 24/11.

A materializacao agora usa `next_shipping_date` quando a campanha nao informa previsao. Essa funcao mantem o dia semanal configurado e sempre retorna uma data posterior; sua leitura de `app_settings` ficou qualificada para funcionar tambem dentro das rotinas com `search_path` vazio. Datas explicitas continuam preservadas.

O reparo de dados abrange apenas premios de campanhas sem previsao, pedidos pagos, conquistados em 19/11, cuja data ainda era a automatica da conquista, sem edicao, movimento, cancelamento ou etiqueta. Nao altera lotes, pagamentos, premios ja separados ou conteudo de pacotes emitidos.

O filtro do relatorio nao foi alterado: continua respeitando `shipping_date` de cada item. Em producao foram confirmadas zero pendencias ativas e zero lotes ainda nao enviados em 19/11; os sete premios passaram para 24/11.

Validacao: 12 testes especificos de datas, movimentacao, previsao opcional e isolamento entre dias passaram; lint do teste novo passou. A execucao ampla de `reports.test.mjs` tambem encontrou duas expectativas antigas sobre liberacao manual de frete de premios zerados que nao passam na base atual; esta entrega nao altera a regra de frete nem o carregador do relatorio.
