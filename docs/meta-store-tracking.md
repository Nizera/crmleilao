# Rastreamento da loja pela Meta

Pixel existente: 1074294225103386. Escopo: /loja e /painel/loja.

## Configuração

Na Vercel Production: META_PIXEL_ID e META_CONVERSIONS_ACCESS_TOKEN (Sensitive).
O token nunca é enviado ao navegador. META_TRACKING_DISABLED=true interrompe os envios.
META_GRAPH_VERSION é opcional (padrão v25.0). META_TEST_EVENT_CODE é opcional e
deve ser usado apenas durante validação no Gerenciador de Eventos. Remova-o para operação real.
Preview e desenvolvimento não enviam eventos, mesmo usando o banco de produção.

## Eventos

Navegador: PageView, ViewContent ao abrir detalhes, AddToCart após adição,
Search sem texto livre e InitiateCheckout. Somente após aceite de publicidade.
Purchase é enviado exclusivamente pelo servidor: evita depender do retorno ao app
e não duplica a conversão com o navegador. Cada pedido possui um event_id estável.
Não há compra retroativa ao consultar históricos.

Valor: cash_total menos freight_amount, já descontado o voucher, em BRL.
Não converte Caracoins em receita. Voucher integral e frete isolado não geram Purchase.
O custo interno não participa dessa mensuração. Estornos não apagam automaticamente
uma conversão já recebida pela Meta; o financeiro do CRM continua sendo a referência.

## Consentimento e privacidade

Preferência por até 180 dias. Revogação interrompe navegador e novos envios pendentes.
A sessão first-party HTTP-only mantém atribuição na passagem da vitrine para o login.
São preservadas UTMs iniciais válidas e os identificadores fbp/fbc quando disponíveis.
E-mail e telefone são normalizados e passam por SHA-256 no servidor. CPF, observações,
dados bancários e texto livre de busca não integram o payload da API.
URLs da API são canônicas, sem parâmetros pessoais. Consentimento não anonimiza dados.
Consulte /privacidade-loja. Contato pelo SAC habitual do aplicativo.

## Entrega e operação

Migration 0095 cria tabelas privadas, trigger da transição paid e fila transacional.
Atribuição é vinculada somente ao pedido do cliente autenticado e recém-criado.
Pagamento confirmado, reconciliação e compras já pagas no checkout utilizam a mesma fila.
Envio pós-resposta em lotes pequenos; erro da Meta não desfaz compras ou estoque.
Tentativas preservam o identificador e o horário original; lease evita processamentos simultâneos.
Máximo de dez tentativas e seis dias, sem alterar a data para aparentar evento recente.
Entrega imediata pelo webhook; novas tentativas por visitas consentidas, operação manual e
cron diário separado às 09:30 UTC (compatível com o cron diário já utilizado).
Para maior volume ou garantia de recuperação em minutos, configurar agendador mais frequente
após confirmar o plano da Vercel. A instalação não promete atribuição integral de todas as vendas.

Painel: /admin/fidelidade/meta. Mostra presença de credenciais, status e códigos de erro,
sem exibir tokens ou contatos. Botão de processamento restrito a equipe com escrita.
O recebimento pela API não equivale à atribuição da venda a um anúncio.

## Validação

node --test scripts/meta-commerce.test.mjs
npm run test:store
npm run build

Validar no Gerenciador de Eventos: consentimento, navegação, carrinho, checkout e
compra confirmada. Testes locais da API usam HTTP simulado e não representam confirmação
de recebimento pela Meta. Verificar permissões de tráfego para o domínio da loja e
vinculação da conta de anúncios. Catálogo de anúncios é uma etapa posterior e deve usar
o UUID do produto como content_id, consistente com os eventos atuais.
