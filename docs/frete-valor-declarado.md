# Declaração manual na etiqueta

Publicado em 02/11/2026 pelo hotfix isolado `055bc06`, a partir da versão de produção `e8221f4`. Novas funcionalidades da loja/rifa não foram incluídas.

- Campo Valor declarado do pacote na emissão: zero/vazio usa subtotal; positivo substitui o valor da declaração. Quando subtotal também for zero, informar valor positivo antes de cotar.
- Seguro permanece opcional: zero sem seguro; positivo deve coincidir com a declaração.
- Cotação e emissão validam valores no servidor. Não altera arremates, cobranças, receita ou moedas. Declaração e opção de seguro são registradas nos eventos do envio.
- Produção usa `bind_store_orders_to_shipment` e colunas existentes; esse hotfix não exige a 0051. Build, TypeScript, lint e quatro testes isolados passaram. Deploy Production confirmado pela Vercel; login HTTP 200. Nenhuma etiqueta real foi emitida pela revisão.
- A versão completa ainda local usa outro vínculo (`bind_shipment_contents`). Para ela, a migration **0051** preserva a declaração manual junto do snapshot de conteúdo. Foi validada em PGlite, mas não aplicada ao banco compartilhado. Incluir essa migration na preparação da futura publicação completa; não confundir sua dependência com o hotfix já publicado.
