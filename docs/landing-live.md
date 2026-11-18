# Catálogo e arremates reais na landing

Somente alterações locais; nenhuma publicação ou migration aplicada.

GET /api/landing/catalog projeta oito lotes mais recentes não cancelados (id, título, foto e criação). Não retorna cliente, telefone, valor de compra, notas ou informações financeiras. Produtos vêm da RPC pública get_public_store_catalog, com disponibilidade, publicações ativas e imagens reais, priorizando Legends entre os resultados. Não inclui rascunhos.

Ao finalizar saveLot, after() envia um sinal vazio ao canal público public-landing-catalog-v1. O navegador recebe o sinal e consulta novamente a projeção pública. Nenhum payload recebido do canal é tratado como dado confiável. Notificações só aparecem para IDs novos observados depois da carga inicial. A segurança é a projeção pública, não o nome do canal. A CSP libera somente o WebSocket da origem Supabase configurada.

Consulta de recuperação a cada 15 segundos, no retorno à aba e após reconexão. Sinais perdidos não impedem os dados de atualizarem. Em ambiente de múltiplas instâncias, Supabase Broadcast distribui o sinal. O caminho de saveLot é imediato após conclusão; alterações por importações ou SQL externo são recuperadas pela consulta periódica. Notificação dentro da página aberta, sem push, e-mail ou mensagens de WhatsApp.

Validação: testes de projeção pública e detecção de novos lotes, lint e TypeScript. No ambiente desta sessão as consultas reais retornaram TypeError: fetch failed. Portanto catálogo e entrega do Broadcast ainda precisam de confirmação com conectividade Supabase disponível. Não foram criados lotes de teste no banco real.
