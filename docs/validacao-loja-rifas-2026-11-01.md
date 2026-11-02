# Validação e correções — Loja e Rifas

Revisão iniciada em 01/11/2026 e atualizada em 02/11/2026. Complementa o relatório original de auditoria, que permanece como registro dos achados anteriores às correções.

## Estado de entrega

Correções locais concluídas nos caminhos abaixo. **Sem deploy e sem aplicação de SQL no banco compartilhado nesta revisão.** A liberação de produção ainda depende das migrations e de homologação integrada dos provedores. O usuário definiu o frete de prêmio avulso por conta da empresa, implementado na 0048. Não é certificação de segurança absoluta.

## Correções verificadas

| Achado | Correção |
|---|---|
| 0043 vazia | Recuperação da versão original pelos patches desta conversa; testes de rifa reproduzíveis novamente. SHA-256 do arquivo recuperado: `a8e0edbfb528cfcfaca9696540eb5f3ee4b3ab0e6cb57ec85e15ecb47d5b8e58`. Não reconstruída por suposição. |
| Coins + frete sem e-mail | 0045 valida e-mail antes de reservar recursos para o Pix do frete; rollback cobre pedido, estoque e moedas. Crédito de frete já pago continua dispensando outro Pix. |
| Prêmio fora da declaração | 0046 exige valor declarado ao colocar prêmio na caixa. Declaração e seguro incluem esse valor; lotes continuam como Documento com seu subtotal. |
| Conteúdo mudando durante emissão | Snapshot de IDs/valores comparado antes e depois do vínculo, com locks e rollback quando diverge. Snapshot persistido no envio. |
| Polling excedendo limite | Uma sincronização por página, três pedidos por rodada, rotação e timeout; limites separados de loja e rifa. |
| Confirmação antiga na tela | Cartão renderiza o pedido recebido do servidor; mudança de pago para análise remove confirmação e prêmio sem remontagem. |
| Pix vencido ainda oferecido | Relógio retira instrução de pagar/QR, mantendo conferência no provedor e sem liberar cotas no navegador. Vale também para pedidos da loja. |
| Estorno de prêmio já vinculado | Bind e pagamento da etiqueta conferem a reserva da rifa; cancelar etiqueta conserva a exclusão logística do prêmio em análise. |
| Revisão financeira sem saída | 0047 permite conferência conservadora de estorno integral pelo servidor, com autorização, identidade/valor, evento e retenção dos prêmios revelados. Não aceita prova do navegador nem faz reembolso. |
| Reabertura após resultado | Banco recusa reabrir vendas/reservar após apuração principal; interface deixa de oferecer reabertura. |
| Crescimento das consultas | Índices por cliente/pedido em prêmios; consultas de pendências da fila de envio divididas em blocos de 100 clientes. |
| Prêmio avulso sem envio | 0048 inclui prêmio na fila mesmo sem leilão/loja; declara/segura e vincula pacote exclusivo com frete por conta da empresa. Não cria cobrança ou usa crédito pago pelo cliente. Pacote misto mantém a regra normal de frete. |

Prêmios principais já apurados, prêmios vinculados a etiquetas não canceladas e estornos não integrais permanecem sob análise humana. Não se redistribuem automaticamente prêmios já revelados nem cotas pertencentes a outra compra.

## Verificação

- `npm run test:release`: **99 testes passaram, zero falhas**, na execução final de 02/11/2026. Usa SQL real em PGlite descartável, identidades/perfis separados e HTTP simulado. Cobre loja, voucher, moedas, frete, autorização, idempotência, estoque, assinatura/replay de webhook, cotas, revelação, resultado, estorno, conteúdo do envio e frete por conta da empresa.
- `npm run lint`: passou.
- `npm run build`: passou com TypeScript e geração de 53 páginas. Não executa transações reais.
- Regressão direcionada de pacote e revisão: **10 testes passaram**. Está incluída na execução final; não é somada aos 99.
- Dependências de produção: auditoria npm desta revisão reportou zero vulnerabilidades conhecidas; não foram instaladas dependências novas durante as correções.
- Revisão visual em bancada local sem backend, com os componentes reais e dados fictícios: catálogo, criação de campanha, participação e cartões de cotas/prêmios em larguras externas 295/320/360/390/417/768/1360 px. **28 combinações renderizadas sem overflow horizontal.** Barras/bordas reduzem a área interna em até 17 px.
- Carrinho em celular estreito: produto de R$ 80 + frete R$ 20 = R$ 100, rodapé de pagamento acessível e corpo rolável. Nenhum botão de gerar Pix foi executado.
- Troca simulada de pago para análise preservando a instância do componente removeu a mensagem de prêmio e a confirmação; pedido expirado não ofereceu QR ou botão de pagar.

## Migrations para o banco existente

Aplicar em ordem, antes de publicar o código que depende dos campos/RPCs:

1. `0045_store_checkout_email_guard.sql`
2. `0046_shipment_content_snapshot.sql`
3. `0047_raffle_review_resolution.sql`
4. `0048_raffle_prize_shipping.sql`

Pressupõem as migrations anteriores, incluindo 0043/0044 já aplicadas. **Não reaplicar a 0043 recuperada em banco que já tem as tabelas de rifas.** Nenhuma das quatro novas migrations libera compras globalmente, zera dados, altera saldo ou cria cobrança. Prêmios antigos já separados sem valor precisam ter seu valor confirmado no relatório antes de nova emissão.

Como alternativa às quatro execuções individuais, `supabase/releases/2026-11-02-loja-rifas.sql` reúne as mesmas migrations em uma transação. Executar uma vez; não executar também os arquivos individuais após o pacote.

## Regra definida de frete dos prêmios

O usuário definiu: a empresa paga o frete de um prêmio enviado sozinho. Implementado no banco, fila administrativa, declaração e tela de envios do cliente. O cliente não recebe cobrança nem perde crédito de frete já pago. Se houver lote ou produto da loja para o mesmo pacote, mantém-se a regra normal de frete. O banco recusa converter pacote misto em isento ou omitir um lote pago elegível para obter isenção.

## Limites desta validação

- Não houve consulta/alteração de produção, teste financeiro real, compra, sorteio, etiqueta ou deploy. Nenhum e-mail foi enviado.
- A bancada visual usa dados fictícios e ações simuladas; não comprova o fluxo completo autenticado do Next/Supabase, fontes finais, headers de navegação, todas as páginas administrativas, acessibilidade integral ou métricas Web Vitals.
- PGlite valida regras e transações, mas não substitui disputa simultânea com duas conexões PostgreSQL, teste de carga ou latência de produção. Docker não foi iniciado.
- API externa e transação PostgreSQL não são atômicas entre si. Um estorno que ocorrer depois da última conferência e durante uma chamada externa exige reconciliação e intervenção operacional; não há promessa de cancelamento remoto instantâneo.
- Assinatura de webhook, entrega real da notificação, Pix e SuperFrete precisam de homologação integrada controlada após aplicar SQL. A configuração da Vercel não foi relida; o usuário informou que o segredo do webhook já está configurado lá.
- Não foram instalados/executados scanners adicionais como Semgrep, Gitleaks ou Trivy. Os limites da varredura manual e histórica constam no relatório original.

## Próxima liberação

Manter a chave global de compras atual enquanto as migrations e a homologação estiverem pendentes. Depois das migrations, validar o fluxo integrado com uma compra controlada pelo responsável: pagamento confirmado uma vez, prêmio único, separação/valor declarado, emissão, cancelamento e rastreio. O responsável executa a transação financeira; a revisão não simulou sucesso de provedor como pagamento real.
