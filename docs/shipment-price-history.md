# Histórico do custo das etiquetas

Aplicar `supabase/migrations/0057_shipment_price_history.sql` antes de publicar esta versão.

## Tela de envios

- Fila restrita à data prevista selecionada, com lotes pagos e pendentes de pagamento. Lotes postados/entregues e os vinculados a etiqueta ativa de outra data não aparecem como novos pendentes.
- “Não pago” soma apenas os lotes visíveis dessa data. A emissão mantém sua validação global de pendências; a filtragem visual não libera uma etiqueta bloqueada.
- Busca por rastreio, código, nome ou telefone. Para etiquetas já postadas/entregues, usar o histórico, que tem filtro de data e opção “Todas as datas”.
- Coluna “Emissão” nas duas visões. Em etiquetas antigas mostra o primeiro valor disponível, sem afirmar que conhece o valor original.
- Resumo agrega o conjunto filtrado completo via RPC protegida, incluindo etiquetas já postadas, e exclui canceladas de quantidade e valor. Indica canceladas, preços ausentes e baselines legados. Na fila, filtros locais de pagamento/ordenação não alteram esse resumo de etiquetas do dia.
- Layout da fila em cartões abaixo de 1024px; mantém os controles de emissão e pagamento.

- Histórico > Alteração de custo: todas as alterações, aumentos ou reduções acumuladas em relação ao primeiro valor registrado.
- Detalhes: primeiro valor, último valor, diferença e até 50 alterações recentes. Consultar histórico carrega os registros somente quando solicitado.
- Sincronizar consulta `order/info`. Eventos válidos do webhook também consultam o preço atual na API autenticada; preços de eventos antigos não são usados como verdade atual.
- A mudança de preço é registrada atomicamente pelo banco. Consultas iguais não duplicam histórico; voltar ao preço inicial mantém as alterações anteriores.
- Etiquetas anteriores à implantação recebem o preço atualmente salvo como referência, identificado como legado. Não é possível recuperar automaticamente preços anteriores já sobrescritos.
- Não altera os R$ 20 de frete do cliente, pagamentos, Caracoins, lotes ou valores declarados.
- Há confirmação documental de `price` como valor total da etiqueta, mas não de que ajustes na carteira sejam refletidos nesse campo. Não interpretar ausência de mudança na API como prova de ausência de cobrança adicional.
- Não há evento específico de reajuste no webhook documentado. A consulta acontece na sincronização manual e ao receber eventos de status; não é uma varredura periódica do extrato.
- O histórico é acessível apenas à administração por RLS; clientes não podem ler nem inserir registros. Nenhuma edição de histórico na interface.

## Validação real pendente

Quando houver uma etiqueta com ajuste conhecido: anotar valor original e débito/crédito do extrato, sincronizar o envio e comparar `price` da API com os dois valores. Se `price` não mudar, será necessário outro recurso oficial para consultar o ajuste; o sistema não inventa a diferença. Até esta validação, a tela é um histórico de **valores informados pela API**, não uma conciliação completa da carteira.

Referências oficiais: https://superfrete.readme.io/reference/tag-informações-do-pedido e https://ajuda.superfrete.com/artigo/diferenca-no-valor-calculado/
