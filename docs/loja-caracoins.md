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

**Fidelidade → Pedidos e resgates** mostra os pedidos recentes da loja, clientes, itens, quantidades, totais e situação. Filtros: pagos para separar, aguardando pagamento, em análise, concluídos e todos. Os indicadores de reais/Caracoins são da lista recente, não do histórico inteiro. Resgates antigos continuam acessíveis abaixo.

Somente pedidos pagos podem ser separados/concluídos. As mensagens do campo do pedido são visíveis ao cliente. Produtos da loja ficam nesta fila; entrega/utilização e associação física com envios de lotes são organizadas pela equipe.

Em compras somente com Caracoins, a equipe pode cancelar antes da conclusão e devolver moedas/estoque. Em compras com Pix, a devolução integral deve ser feita no Mercado Pago; o webhook devolve as Caracoins uma vez. Itens já concluídos não voltam automaticamente ao estoque, pois precisam de conferência física. Devolução parcial bloqueia a separação e exige conferência da equipe. Pagamentos recebidos depois do encerramento entram em análise sem recriar a reserva ou liberar o pedido para separação.

O estoque do catálogo significa **disponível**, já descontadas as reservas. A edição do ADM compara `updated_at`; uma reserva/alteração concorrente impede salvar um formulário desatualizado e sobrescrever o estoque.

## Ativação

1. Aplicar `supabase/migrations/0024_store_cart_and_pix.sql` após a 0023, no SQL Editor do Supabase. A migration é transacional e não recalcula pontos existentes.
2. Aplicar `supabase/migrations/0025_store_catalog_admin.sql` após a 0024. Ela adiciona SKU, categoria, galeria, arquivamento, filtros e importação administrativa.
3. Publicar esta versão do aplicativo logo após aplicar os dois arquivos. A migration 0024 substitui o checkout antigo de um único resgate pelo carrinho.
4. Configurar os preços desejados e conferir o primeiro pedido no ADM. A integração usa as credenciais e o webhook do Mercado Pago já existentes; não exige novas variáveis.

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
