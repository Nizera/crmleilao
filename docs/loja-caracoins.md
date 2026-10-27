# Loja, carrinho e Caracoins

## Prévia temporária — 0033

Novas compras/resgates estão bloqueados por `STORE_PREVIEW_ONLY` no cliente e nas Server Actions. O catálogo continua visível, com aviso de prévia e controles desabilitados. Pedidos existentes, pagamentos já gerados, histórico e extrato continuam acessíveis; administração, recebimento de webhooks e reconciliação não são interrompidos.

Aplicar `0033_store_preview_only.sql` para completar o bloqueio também no acesso direto à API Supabase. A função original de checkout é preservada com outro nome e sem permissão de execução para clientes, anon ou service role; a função pública recusa novas compras. Não são alterados pedidos/saldos/reservas existentes. Reativar o programa nas configurações não remove essa trava: a liberação futura exige revisão explícita do código e nova migration para restaurar a função/permissões.

## Atualização 0032 — frete único do envio acumulado

Aplicar `supabase/migrations/0032_freight_per_accumulated_shipment.sql` após 0031 e antes do deploy desta versão. Esta regra substitui a cobrança antiga por semana: o pacote acumulado custa R$20, mesmo com lotes de vários períodos. Frete pago ainda sem etiqueta ativa pode ser usado por novos lotes antes da emissão. Uma etiqueta consome um pagamento de frete; cancelá-la torna esse pagamento disponível de novo. Outro pacote exige outro frete de R$20, inclusive na mesma semana.

O relatório, fila de envios, bloqueio de etiqueta e painel consultam o mesmo estado por pacote. São registrados vínculos explícitos de uso do frete. A migração tenta reconhecer uso anterior pelos lotes/itens de frete associados aos pacotes existentes; não reembolsa nem altera valores de cobranças externas antigas. Pix antigos com R$40 de frete continuam com o valor original no provedor: cancelar e gerar outro, sem editar somente o valor na tela. Se já houve pagamento, conferir eventual devolução no Mercado Pago.

A página principal mostra somente os lotes do dia em Brasília e os pendentes de qualquer data. Retirado o seletor de situação, mantida busca por código/nome/descrição. Cards de status do frete e a lista de envios ficam em Envios. A composição obrigatória de frete no pagamento continua visível para o cliente saber o que está pagando.

## Atualização 0031 — recuperação e logística integrada

**Antes de publicar:** aplicar `supabase/migrations/0031_store_reliability_and_fulfillment.sql` depois da 0030. A migration é transacional e não recalcula saldos, preços ou pagamentos anteriores. Produtos e itens anteriores são classificados como físicos por padrão; pedidos já concluídos permanecem concluídos. Revisar no catálogo os produtos que forem benefícios digitais; a mudança vale para novas compras.

- **Pix:** a loja salva a Order mesmo quando o QR ainda não está pronto. As próximas consultas usam o ID salvo e atualizam o QR, sem criar outra cobrança. Chamadas têm timeout e a criação mantém a chave idempotente. O horário alternativo de vencimento permanece em UTC, corrigindo o deslocamento de três horas.
- **Recuperação:** botão “Recuperar pagamentos pendentes” em Loja → Pedidos consulta até dez pedidos por execução. Os pedidos recebem uma lease de cinco minutos para evitar consultas duplicadas concorrentes e uma mensagem administrativa quando a tentativa falha. Nenhum estoque/Caracoin é liberado apenas pelo relógio ou timeout.
- **Automação:** cadastrar na Vercel `CRON_SECRET` com um valor aleatório forte, exclusivo do servidor. `vercel.json` agenda uma execução diária às 09:00 UTC (06:00 em Brasília), até dez pedidos por execução. A rota exige `Authorization: Bearer ...`; sem segredo, responde 401. O botão administrativo independe do cron. Para volume maior, ajustar frequência ao plano da Vercel e ao volume; o lote é limitado intencionalmente. Não incluir o segredo em capturas, URLs ou código.
- **Produto físico:** pedido pago → “Iniciar separação” → “Colocar na caixa do cliente” → vínculo automático à etiqueta dos lotes → conclusão na entrega confirmada. Compras físicas do cliente criadas até a data do pacote precisam estar na caixa antes da emissão. O relatório padrão mostra os itens por nome/quantidade, identificados como Loja, junto dos lotes elegíveis do cliente. A reserva de estoque da loja continua no checkout; colocar na caixa não debita novamente.
- **Frete:** os produtos seguem no mesmo pacote dos lotes pagos e aproveitam o frete do período validado pelo fluxo existente. Não há segunda cobrança automática de frete. Sem lotes elegíveis/frete quitado, o pedido permanece na fila/caixa para a equipe combinar o envio; não é liberado um frete grátis isolado. O formulário e a emissão no servidor bloqueiam produtos físicos ainda não separados. Peso e dimensões devem considerar todos os produtos da caixa; os valores padrão continuam sendo estimativas.
- **Valores:** vendas da loja e Caracoins permanecem separadas de gastos em arremates, ranking e cobrança dos lotes. A regra vigente da declaração dos lotes na SuperFrete permanece “Documento” com o subtotal dos lotes; esta alteração não redefine valores fiscais/seguro das compras da loja.
- **Rastreio:** a compra mostra o envio associado e o cliente abre o acompanhamento existente em Envios. O pacote também lista os produtos físicos da loja. Cancelar a etiqueta libera o vínculo, preservando a caixa pronta para novo envio. Entrega confirmada conclui somente pedidos ainda pagos. Estorno de pedido já postado não repõe estoque automaticamente.
- **Benefício digital:** tipo selecionável no produto; a equipe pode concluir sem etiqueta. Um carrinho contendo algum produto físico segue a logística física; os itens digitais continuam discriminados no pedido.
- **Auditoria:** eventos de criação, pagamento, separação, caixa, vínculo, conclusão e alteração de mensagem são registrados com ator/horário. Clientes não leem essa tabela; equipe tem leitura sem poder editar/apagar eventos pela API. O histórico começa nesta migration e não inventa eventos anteriores.

### Operação de incidentes

1. Pedido sem QR: usar consulta individual ou recuperação de pendentes. O ID salvo deve ser reutilizado.
2. Pedido ainda em `creating`, sem ID: recuperação repete a criação com a mesma chave; nunca gerar outra referência para tentar resolver. Persistindo falha, conferir no Mercado Pago pela referência do pedido e verificar credenciais/dados do pagador.
3. Timeout, 404 ou falha de comunicação não provam ausência de pagamento. Não cancelar localmente nem devolver reserva sem confirmação. Casos de criação incerta exigem conciliação com o provedor antes de qualquer intervenção manual no banco.
4. Pedido pago por Pix: devolver no Mercado Pago; webhook/consulta aplicam o resultado. Antes da postagem, cancelar a etiqueta vinculada quando necessário. Após postagem, estoque físico não volta automaticamente e a equipe deve conferir a devolução.
5. Reembolso parcial/pagamento tardio: manter em análise, sem separação automática, até resolver a divergência financeira.

### Testes adicionais

`npm run test:store` inclui as migrations reais 0026, 0027, 0028 e 0031 em fixture ampliada, HMAC do webhook, retomada do QR, prazo HTTP, UTC, trilha de eventos, snapshots, caixas, cancelamento/entrega e estorno depois da postagem.

`npm run test:store:concurrency` é um teste opt-in com PostgreSQL real e duas conexões via Docker. Cria e remove exclusivamente um container local com nome aleatório `ocdl-store-test-*`; não usa `.env`, portas públicas ou banco externo. Testa última unidade e repetição simultânea do mesmo checkout. Requer Docker já disponível; sua execução não substitui homologação financeira. Se o daemon não estiver disponível, o teste falha explicitamente em vez de registrar sucesso.

## Preços e compra

Em **ADM → Fidelidade → Produtos**, cada produto pode oferecer uma ou mais modalidades:

- Apenas Caracoins: campo `points_cost`.
- Apenas reais: campo `cash_price`, recebido por Pix.
- Combinado: `mixed_cash_price` **mais** `mixed_points_cost` por unidade.

Não existe taxa de conversão automática. Exemplo: o mesmo produto pode custar 200 Caracoins, R$ 50 ou R$ 20 + 100 Caracoins. O ADM decide cada opção; campos vazios desabilitam a modalidade. O combinado exige os dois valores. Custo interno fica acessível somente à equipe pelo servidor.

O carrinho aceita quantidades e diferentes modalidades, guarda o conteúdo no navegador por cliente e exibe os dois totais antes da confirmação. A modalidade também pode ser alterada dentro do carrinho. Mudanças de preço exigem nova aceitação. Remover itens não cria pedidos.

O cabeçalho do cliente mostra o saldo disponível de Caracoins e abre a loja. Caracoins continuam sendo geradas pelos lotes pagos conforme os elos; a compra na loja não gera moedas nem aumenta gastos de lotes, ranking ou declaração de conteúdo dos lotes. Não há carteira de reais nem recarga de Caracoins.

## Reserva e pagamento

O PostgreSQL recalcula preços, valida saldo e reserva estoque/Caracoins numa única transação. Não usa totais enviados pelo navegador. Há limites de 50 combinações e 99 unidades por combinação. Um cliente pode ter apenas um pedido com Pix aberto.

Uma chave por versão do carrinho identifica tentativas repetidas. O mesmo pedido usa uma referência estável `shop_<UUID>` no Mercado Pago, inclusive em retomadas após falha de rede. Pedidos da loja não usam `charges` nem vinculam lotes de leilão.

Compras somente em Caracoins já ficam pagas. Compras com reais geram um único Pix para todo o valor em dinheiro. O webhook existente valida assinatura e reconsulta a Orders API; a loja também consulta a cada 15 segundos enquanto a página está visível. A confirmação aparece automaticamente, sem exigir o botão de verificação.

Caracoins e estoque só são liberados após o Mercado Pago confirmar cancelamento, expiração ou falha. A hora do navegador não confirma expiração. Falhas de comunicação preservam o pedido e a reserva para retomar o mesmo pagamento.

## Operação do ADM

**Loja → Pedidos** reúne compras do carrinho e resgates antigos na mesma lista, identificados pela origem. Abas: todos, para separar, em separação, aguardando pagamento, concluídos, em análise e encerrados. Busca por cliente, telefone ou código; filtro de origem e período (horário de Brasília); paginação de 10, 20 ou 50 pedidos no banco. As contagens abrangem o histórico da busca/origem/período, não apenas a página atual. Os detalhes e ações de cada pedido abrem ao clicar na linha.

Não existe aprovação manual do pagamento. Pix é confirmado pelo Mercado Pago e compras com Caracoins debitam as moedas no checkout. Nos resgates antigos, o antigo botão "Aprovar" foi renomeado para "Iniciar separação": o crédito já foi debitado quando o cliente resgatou. "Concluído" significa que a equipe já finalizou esse pedido e não exige ação adicional.

Somente pedidos pagos podem ser separados/concluídos. As mensagens do campo do pedido são visíveis ao cliente. Produtos da loja ficam nesta fila; entrega/utilização e associação física com envios de lotes são organizadas pela equipe.

Em compras somente com Caracoins, a equipe pode cancelar antes da conclusão e devolver moedas/estoque. Em compras com Pix, a devolução integral deve ser feita no Mercado Pago; o webhook devolve as Caracoins uma vez. Itens já concluídos não voltam automaticamente ao estoque, pois precisam de conferência física. Devolução parcial bloqueia a separação e exige conferência da equipe. Pagamentos recebidos depois do encerramento entram em análise sem recriar a reserva ou liberar o pedido para separação.

O estoque do catálogo significa **disponível**, já descontadas as reservas. A edição do ADM compara `updated_at`; uma reserva/alteração concorrente impede salvar um formulário desatualizado e sobrescrever o estoque.

## Ativação

1. Aplicar `supabase/migrations/0024_store_cart_and_pix.sql` após a 0023, no SQL Editor do Supabase. A migration é transacional e não recalcula pontos existentes.
2. Aplicar `supabase/migrations/0025_store_catalog_admin.sql` após a 0024. Ela adiciona SKU, categoria, galeria, arquivamento, filtros e importação administrativa.
3. Publicar esta versão do aplicativo logo após aplicar os dois arquivos. A migration 0024 substitui o checkout antigo de um único resgate pelo carrinho.
4. Configurar os preços desejados e conferir o primeiro pedido no ADM. A integração usa as credenciais e o webhook do Mercado Pago já existentes; não exige novas variáveis.

Para a lista unificada de pedidos, aplicar também `supabase/migrations/0026_admin_order_history.sql`, após a 0025 e antes de publicar a atualização. Ela cria uma consulta administrativa protegida e índices de ordenação; não altera pagamentos, saldos ou situações existentes.

## Dashboard da loja

Aplicar `supabase/migrations/0027_store_dashboard.sql` após a 0026 e antes de publicar o dashboard. A consulta exige acesso administrativo e reúne compras do carrinho e resgates antigos; não lê lotes, fretes ou créditos de pontos ganhos.

Períodos: hoje, últimos 7 dias, últimos 30 dias e personalizado de até 366 dias, em horário de Brasília. Indicadores, gráfico e produtos mais vendidos consideram compras atualmente confirmadas, pela data de confirmação (ou criação quando não há `paid_at`). Resgates antigos usam a data de criação. Cancelamentos, estornos integrais/parciais e pagamentos em análise não entram; por isso um estorno pode mudar um período anterior. Reais e Caracoins permanecem separados.

O custo interno é copiado para cada item nas novas compras pela trigger `store_item_cost_snapshot`. Custos antigos não são preenchidos com o valor atual. O dashboard informa quantas unidades do período estão sem custo histórico e mostra apenas o custo conhecido, sem calcular lucro. O custo não inclui taxas, tributos ou entrega; o campo histórico de custo é oculto para clientes nas permissões do banco.

As pendências operacionais e alertas do catálogo consideram todo o histórico, independentemente do período. Os cinco últimos pedidos usam a data de criação dentro do período e levam à busca correspondente. Alertas abrem o catálogo filtrado por estoque baixo, esgotado, sem foto ou sem custo.

## Históricos e navegação da loja

Aplicar `supabase/migrations/0028_loyalty_history_and_client_store.sql` após a 0027 e antes desta publicação. A loja do cliente tem seções Produtos, Meus pedidos e Extrato. O catálogo consulta 20 produtos por página, com busca, categoria, forma de pagamento e ordenação. Itens do carrinho são reconsultados por ID (até 50), independentemente da página atual; erros impedem confirmar a compra até nova consulta.

Meus pedidos reúne compras do carrinho e resgates antigos, com período, situação e páginas de 10 registros. O Pix em andamento continua acessível no topo da vitrine e na seção de pedidos, com confirmação automática. O extrato do cliente e do ADM tem filtros, paginação de 10/20/50 e totais do filtro, explicitamente diferentes do saldo disponível. As consultas do cliente usam seu ID autenticado e não recebem um ID arbitrário do navegador.

O ajuste administrativo busca até 20 clientes por nome/telefone, consulta o saldo e exige revisar cliente, valor e motivo antes de confirmar. Uma chave UUID torna a repetição da mesma confirmação idempotente no banco. Após uma falha de rede, repetir na mesma confirmação; consultar o extrato antes de iniciar uma solicitação diferente. O ajuste não muda o elo.

As configurações consultam apenas regras e as últimas dez mudanças. Falhas de saldo, catálogo e históricos mostram indisponibilidade com nova tentativa, em vez de saldo zero ou histórico vazio. A migration 0028 não altera movimentos anteriores.

## Catálogo administrativo

O menu **Loja** reúne visão geral, produtos, pedidos, Caracoins e configurações. Produtos tem busca por nome/SKU, filtros por categoria, publicação e pagamento, paginação e ações em lote com validação de alterações concorrentes. Arquivar oculta o produto sem apagar pedidos anteriores.

Cada produto tem página própria com descrição, SKU único, categoria, custo interno, estoque disponível/reservado e até seis fotos. A primeira foto é a capa; é possível adicionar por arquivo, arrastar ou colar com Ctrl+V. As fotos são otimizadas no navegador e validadas no servidor. O cliente pode abrir os detalhes e navegar pela galeria.

As modalidades reais, Caracoins e combinado podem ser oferecidas separadamente ou juntas. O custo interno é exclusivo da equipe. Produtos publicados exigem custo informado e pelo menos uma modalidade completa.

A importação aceita CSV de até 200 produtos, com modelo para baixar e prévia antes da confirmação. Todos entram como rascunho, sem fotos; SKU existente rejeita o lote inteiro. Repetir a mesma confirmação não duplica a importação. Fotos e publicação são revisadas na edição do produto.

Sem a migration, a tela nova informa que a loja está em atualização. O restante do painel continua acessível.

## Verificação

`npm run test:store` usa PostgreSQL em memória via PGlite (dependência somente de desenvolvimento) e HTTP simulado. Testa cálculo em centavos, requisições idempotentes, reservas, isolamento entre clientes, permissões, preços alterados, saldo insuficiente, estoque, cancelamento, expiração, devolução integral/parcial e pagamento tardio. Não cria pagamentos reais nem acessa o Supabase de produção.

Também executar `npm run build`. A validação visual pode usar produtos fictícios; a rota temporária de prévia não deve ser publicada.

Estes testes não substituem a validação do webhook e de um Pix no ambiente de homologação do Mercado Pago, nem simulam conexões simultâneas de uma instância PostgreSQL real. O bloqueio de concorrência está implementado no banco com advisory locks, locks de produtos em ordem fixa e índices únicos.

Referências oficiais usadas: [cancelamento de order](https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-api/cancel-order/post) e [status da order](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-management/status/order-status).
