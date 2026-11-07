# Cotas premiadas com fotos

Aplicar `supabase/migrations/0064_raffle_prize_photos.sql` antes de publicar.

Em Rifa > campanha > Cotas premiadas, pause a campanha e clique em Adicionar cotas premiadas. O popup permite até 30 tipos e 100 unidades por envio (200 prêmios por campanha). Cada tipo tem nome, quantidade e até quatro fotos. Anexe arquivos ou copie uma imagem e cole com Ctrl+V dentro do bloco do prêmio. As fotos são reduzidas no navegador; o servidor confere tamanho, formato real e permissão de escrita.

As unidades de um mesmo tipo usam as mesmas fotos. Para fotos diferentes, adicione outro prêmio. As cotas são atribuídas aleatoriamente somente entre números livres, sem alterar os prêmios anteriores. A operação é atômica e usa uma chave para impedir duplicação ao repetir uma tentativa. Depois de uma tentativa sem confirmação, os dados permanecem bloqueados para repetir exatamente a solicitação.

As fotos aparecem no cadastro administrativo, na campanha para o cliente, na confirmação da conquista e em Meus prêmios. Fotos individuais têm prioridade sobre as da campanha; prêmios antigos continuam usando a galeria da campanha. Números ocultos e dados de compradores não são retornados pela consulta de fotos.

Não altera pagamentos, sorteios, estoque nem prêmios já atribuídos. Nenhum dado de produção foi criado durante a implementação. Testes SQL usam banco PostgreSQL embarcado isolado.
