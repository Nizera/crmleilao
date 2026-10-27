# Correções da auditoria da loja — 26/10/2026

Implementadas no workspace; publicação depende do SQL 0031 e da configuração abaixo. Auditoria original preservada em `relatorio-auditoria-loja.md`.

| Achado | Tratamento | Evidência de validação |
|---|---|---|
| M-01 — Criação incerta/reserva presa | ID salvo antes de esperar QR; retomada por GET, recuperação administrativa e fila diária protegida com lease; nenhuma liberação pelo relógio | Testes HTTP simulados e SQL de fila/lease |
| M-02 — Ausência de prazo HTTP | 10s por chamada financeira, orçamento de criação e reconciliação; cancelamento também limitado | Teste de propagação de abort e inspeção de todos os fetch financeiros |
| M-03 — Cobertura desatualizada | Novos testes usam migrations reais 0026–0028 e 0031, HMAC, recuperação, eventos e logística; script separado para duas conexões reais | 40 testes passaram. Concorrência real **pendente**, Docker não disponível na execução inicial; não considerada aprovada |
| B-01 — Vencimento +3h | UTC preservado, sem substituir offset | Teste confere três dias sem deslocamento |
| B-02 — Histórico de atendimento | Eventos append-only com ator, horários e estados, visíveis à equipe no detalhe do pedido | Testes de permissões, notas anteriores e repetição da movimentação |
| I-01 — Logística manual | Físicos no relatório/caixa, vinculados ao pacote dos lotes e ao rastreio existente; aproveita frete validado | Testes de bloqueio por pendência, vínculo, cancelamento, reenvio e entrega |
| I-02 — Conclusão direta de físicos | Bloqueada; exige separação/caixa e entrega confirmada. Digitais permitem conclusão direta | Testes dos dois tipos e snapshot imutável da compra |

Também foi corrigida a consulta de frete do relatório para usar `charge_freight_periods`, compatível com o pagamento de mais de um período no mesmo Pix. A regra financeira da loja não foi misturada com lotes/ranking.

## Antes do deploy

1. Aplicar `supabase/migrations/0031_store_reliability_and_fulfillment.sql` após 0030, no Supabase. O SQL é transacional. Não publicar o aplicativo novo antes da migration.
2. Na Vercel, definir `CRON_SECRET` com segredo aleatório forte, somente no servidor. Ele autentica a reconciliação diária das 06h de Brasília, em lotes de até dez pedidos. Sem ele, a rota recusa execução; a recuperação pelo ADM continua disponível.
3. Publicar e conferir os primeiros pedidos. Produtos antigos são físicos por padrão; revisar benefícios digitais no catálogo. Pedidos antigos já concluídos não são reabertos. Pedidos antigos ainda pendentes passam pelo fluxo físico; não foi inventado histórico retroativo.

## Limites e operação

- Testes em banco descartável/PGlite e HTTP simulado. Não houve Pix real, consulta a produção ou deploy deste conjunto.
- Foi iniciado o Docker instalado para tentar o teste extra de concorrência. Após o usuário perguntar sobre a abertura, a tentativa foi encerrada; o comando de parada informou que o Desktop não estava em execução. Nenhum container de teste foi criado nesta tentativa.
- O script opcional `npm run test:store:concurrency` permanece disponível para homologação com Docker já iniciado; não deve ser confundido com os testes locais aprovados.
- Sem lotes/frete disponíveis, a compra fica aguardando combinação com a equipe; não gera um frete gratuito isolado.
- Dimensões/peso precisam incluir os produtos físicos adicionados à caixa. A alteração preserva a declaração/seguro vigente dos lotes e não define política fiscal para produtos diferentes.
- Timeout/erro/QR indisponível nunca autorizam estorno ou liberação de estoque por conta própria. Persistindo criação incerta, conferir o pedido no Mercado Pago pela referência e seguir o runbook em `docs/loja-caracoins.md`.
- As sugestões de otimização dependentes de medição da auditoria não foram transformadas em refatorações especulativas.

## Complemento solicitado — frete acumulado e home

A versão também depende de `0032_freight_per_accumulated_shipment.sql`, após 0031. O frete passa a R$20 por pacote acumulado; semanas não multiplicam a taxa. Pagamento é reservado a uma etiqueta ativa, pode ser reaproveitado após cancelamento e é revalidado antes de pagar a etiqueta. Não foram editados Pix ou pagamentos antigos no provedor.

A home mantém lotes do dia e todos os pendentes antigos, sem filtro de situação. A lista de envios e status do frete foram retirados da home e centralizados em Envios. A busca por descrição foi habilitada também na lista de lotes. Leituras de lotes passaram a buscar páginas estáveis de 500 registros, para pendências antigas não sumirem pelo limite padrão do banco.

Verificações deste complemento: 42 testes passaram, incluindo frete de múltiplas semanas, aproveitamento de crédito, uso em etiqueta, cancelamento, novo pacote, estorno e seleção da home. Lint aprovado. Publicação continua aguardando 0031 e 0032.
