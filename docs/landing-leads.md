# Landing de Legends e Lead

Alteração local, sem publicação ou mudança em variáveis de produção.

Mantém preto, amarelo e creme, imagens reais e demonstração interativa do painel. A vitrine é editorial, usa imagens de lotes anteriores e leva a /loja; não anuncia estoque ou preço.

Reutiliza o Pixel configurado no layout e a preferência de publicidade existente. Em produção: META_PIXEL_ID e VERCEL_ENV=production, com META_TRACKING_DISABLED diferente de true. Desenvolvimento e preview não carregam nem enviam eventos. Nenhuma configuração local ativa o Pixel.

Evento Lead: clique em qualquer link para o grupo oficial na landing, após consentimento. Uma vez por sessão de navegador; eventID estável para deduplicação. Não confirma entrada no WhatsApp. Não envia e-mail, telefone, query string ou dados do painel. PageView permanece separado. Eventos de compra da loja não foram alterados.

Validação: node --test scripts/landing-lead.test.mjs scripts/meta-commerce.test.mjs. Validar recebimento no Gerenciador de Eventos somente na ativação futura em produção.
