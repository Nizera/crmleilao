# Loja, carrinho e Caracoins

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
