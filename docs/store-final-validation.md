# Validação final da loja — 31/10/2026

## Resultado

Código revisado e testes automatizados aprovados. A loja não foi aberta nem publicada nesta validação. Não é possível garantir ausência de falhas ou certificar “100% de segurança”. A liberação depende da migration 0039, configuração do ambiente e piloto real das integrações.

## Correções desta etapa

- Pedido físico sem lote passa a gerar necessidade de frete de R$ 20 e entra na fila e no relatório quando os pagamentos estão regularizados. Reaproveita o crédito disponível, inclusive após cancelamento de etiqueta. Não cria um lote fictício.
- Pedidos físicos pagos acompanham a caixa do cliente. A etiqueta pode conter somente compras da loja ou compras e lotes. O subtotal dos lotes permanece separado do frete.
- Caracoins não são convertidas automaticamente em valor declarado. Na separação, a equipe informa o valor em reais dos produtos físicos pagos em moedas. Produtos em reais usam o preço histórico dos itens físicos, antes do desconto de voucher. Pedidos antigos na caixa sem valor declarado exigem conferência no ADM.
- Endereço e documento são conferidos antes de criar compra física. Benefícios digitais continuam sem obrigação de frete/endereço.
- Lease por cliente bloqueia emissões simultâneas de etiquetas. Produtos, pagamento e frete são revalidados antes da emissão/vínculo/pagamento da etiqueta.
- Cancelar uma compra totalmente coberta por voucher não lança zero Caracoins no extrato. Estoque e reservas seguem as regras idempotentes existentes.
- Recuperação financeira processa pequenos lotes sucessivos, com orçamento de 45 segundos, em vez de apenas dez pedidos. Mantém reservas quando o provedor falha. O cron diário existente não foi alterado; a frequência deve acompanhar o plano e o volume de vendas.
- Abertura/fechamento passa a ser controlado no banco, em Loja → Configurações, restrito ao dono e com motivo registrado em `store_commerce_events`. Fechar não impede o atendimento de pedidos e pagamentos existentes. A migration não abre as compras.
- Ativação verifica programa, produtos disponíveis e preços exclusivos. A action confere a presença das configurações de Mercado Pago, webhook, cron e SuperFrete quando necessárias; presença não comprova validade das credenciais.
- Consultas do relatório são divididas em lotes para não gerar URLs enormes ao crescer o número de clientes.
- Ferramenta CLI `shadcn` movida para desenvolvimento. `npm audit --omit=dev` reportou zero vulnerabilidades em produção nesta execução. Há avisos nas ferramentas de desenvolvimento; não foi aplicado upgrade forçado de dependências.

## Evidências

`npm run test:store`: 60 testes aprovados. Cobrem preço e estoque no banco, saldo insuficiente, concorrência lógica, idempotência, isolamento de clientes, acesso anônimo, perfil de consulta, webhook sem assinatura/assinatura inválida, divergência de valor e referência, cancelamento, estorno parcial/integral, pagamentos tardios, compra digital, compra sem lotes, frete único, reuso após cancelamento, entrega, declaração, lease de emissão e controle do dono.

Também foram executados ESLint, TypeScript e build do Next.js. Os testes financeiros utilizam HTTP simulado e PostgreSQL embarcado descartável (PGlite), sem cobranças, mensagens ou etiquetas reais. Não foi usado Docker.

## Instalação e piloto

1. Aplicar `supabase/migrations/0039_store_shipping_completion.sql` após 0038. Preserva pedidos existentes e não abre a loja.
2. Configurar no ambiente de teste os mesmos nomes de variáveis necessários à operação: `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `MP_WEBHOOK_TOKEN`, `CRON_SECRET` e `SUPERFRETE_TOKEN`. Nunca compartilhar seus valores no chat. Conferir origem de envio e destino completos.
3. Revisar o produto antigo com preço combinado, como Lamine Yamal Prata. Escolher reais ou Caracoins antes de abrir. A ativação recusa preços antigos ambíguos.
4. No ambiente de piloto, abrir pelo perfil dono e validar compra Pix, confirmação por webhook sem clique manual, voucher, cancelamento/estorno e pedido físico sem lote. Conferir pagamento separado do frete na área Pix, separação, valor declarado, etiqueta, cancelamento e rastreio. Usar sandbox/conta de teste compatível com as integrações; cobrança real exige autorização e acompanhamento.
5. Publicar e abrir ao público somente após esse piloto. O ADM mantém recuperação manual de pagamentos e o Mercado Pago continua sendo o local de iniciar devoluções de Pix pagos.

## Limites

- Não houve teste financeiro ou emissão de etiqueta real, teste de carga em produção ou varredura ativa de terceiros.
- PGlite não substitui teste com várias conexões PostgreSQL independentes; os locks e leases foram exercitados no banco embarcado, sem carga distribuída.
- A revisão visual automatizada pelo navegador não ficou disponível. Conferir a interface em aparelhos reais antes da publicação.
- Pagamentos tardios, divergentes e estornos parciais ficam em análise, sem liberação automática dos produtos. Vouchers de compras já pagas não retornam automaticamente após devolução, conforme a regra atual.
- Nenhum relatório de auditoria anterior foi sobrescrito. Nenhuma mudança foi aplicada ao banco de produção por esta execução.
