# Caracoins e vouchers — implantação 0058

| Voucher | Custo |
|---|---:|
| R$ 5 | 500 Caracoins |
| R$ 10 | 1.000 Caracoins |
| R$ 15 | 1.500 Caracoins |
| R$ 20 | 2.000 Caracoins |

Um voucher por compra, até R$ 20, somente em produtos em reais. Frete não recebe desconto. Preço e limite são validados no servidor e no PostgreSQL; escolher outro custo no navegador não altera a cobrança. Vouchers já emitidos mantêm custo e prazo originais; descontos acima de R$ 20 ficam impedidos no novo checkout.

Cada crédito de moedas vence após 90 dias. Créditos anteriores à implantação ganham 90 dias a partir da migration, sem expiração imediata. Débitos consomem primeiro os créditos antigos (FIFO). O saldo consultado já exclui vencidos, mesmo sem cron. Antes de qualquer gasto, o banco serializa pelo cliente, registra a expiração e verifica novamente o saldo; não depende do saldo mostrado no navegador. O cron existente registra as expirações pendentes em lotes de até 200 clientes. A validade de um voucher resgatado continua independente (30 dias nos novos modelos).

A primeira compra paga de lote com valor positivo concede 500 Caracoins e 500 pontos de ranking, uma única vez por cliente, com o programa ativo. Compras anteriores à implantação não recebem bônus retroativo. Frete, loja, rifa e lotes gratuitos não disparam o bônus. Cancelar todas as compras pagas reverte o bônus, sem liberar uma nova concessão; uma parcela já expirada não sofre novo débito. O elo e a pontuação histórica não expiram nem diminuem por usar moedas ou resgatar vouchers.

Implantar a migrations 0058 e 0059 antes de publicar esta versão. Não é necessário adicionar variável nem agendamento: o endpoint de conciliação já protegido pelo CRON_SECRET executa a manutenção. Testes locais usam PostgreSQL isolado (PGlite), sem pagamentos reais.

## Artes

Geradas com a ferramenta integrada image_gen; arquivos public/store/vouchers/voucher-{5,10,15,20}-v2.webp. Prompt comum: imagem de produto 3:2 para Loja dos Caras; ticket preto com borda dourada metálica, textura de cards colecionáveis e moedas douradas; paleta #0A0A0A, #FACC15 e #C9A227; texto VOUCHER, R$ {valor}, LOJA DOS CARAS e {valor*100} CARACOINS; fundo preto, luz de estúdio, sem pessoas ou marcas adicionais. Não substituir esses valores manualmente na imagem.
