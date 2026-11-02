# Vitrine e banners da loja

## Instalação

Aplique `supabase/migrations/0038_store_presentation.sql` após a 0037. Não foi aplicada automaticamente em produção. Ela adiciona o banner e a consulta paginada com filtros; não libera compras nem altera pedidos.

## Banner

No ADM, abra Loja → Banners. Edite título, texto, botão e imagens para computador e celular. Há prévia antes de salvar. Sem imagens cadastradas, a vitrine usa um fundo escuro com produtos do catálogo no computador.

- Computador: sugestão de arte 1600 × 500 px.
- Celular: sugestão de arte 900 × 700 px.
- JPG, PNG ou WebP até 600 KB por imagem. Evite texto na arte; ele é cadastrado separadamente. Deixe espaço livre à esquerda.
- O botão aceita o catálogo ou um link interno da loja.
- Desmarcar Exibir banner remove o destaque da vitrine.
- O perfil de consulta não pode salvar. Uma edição simultânea exige atualizar a página.
- Imagens anteriores são preservadas para páginas e caches ainda abertos. Não há limpeza automática desses arquivos nesta etapa.

## Vitrine

Busca por nome, descrição ou SKU; categorias; moeda; faixa de preço; disponibilidade; ordenação por novidades, nome e valores crescentes ou decrescentes. Filtros são aplicados no banco antes da paginação de 20 produtos. O preço só pode ser filtrado após escolher reais ou Caracoins.

No celular, categorias deslizam horizontalmente, produtos usam duas colunas e filtros abrem em uma gaveta. No computador, a loja usa uma área mais larga, filtros laterais e três colunas. As demais telas do cliente mantêm a largura anterior.

A consulta e os detalhes dos produtos funcionam na prévia. Adição ao carrinho, checkout e resgate continuam bloqueados pela configuração existente.

## Validação

`npm run test:store` testa filtros globais, ordenação, paginação, permissões, preços e vouchers em banco descartável. `npm run build` verifica compilação e tipos. A revisão visual automatizada no navegador ficou indisponível nesta sessão; revisar também em telas reais antes de publicar.
