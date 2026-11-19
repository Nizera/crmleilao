# Verificação do Pixel e funil — 18/11/2026

Configuração pública de produção conferida no navegador em /api/store/marketing: enabled=true, pixelId=1074294225103386, serverConfigured=true. Nenhuma credencial foi exposta.

Lead: clique para o grupo oficial na landing, após consentimento, não confirmação de entrada no WhatsApp. O CTA permanece link direto, sem esperar requisição ou Pixel. Corrigida deduplicação através de recarregamentos na mesma sessão da aba e removido eventID fixo de fallback quando sessionStorage não está disponível.

Consentimento: removida a exceção que impedia syncMarketingChoice na landing. Aceite e revogação agora sincronizam com o servidor na página e na loja; UTMs e fbclid da entrada podem acompanhar o pedido da loja. O endpoint existente mantém source_url canônica da loja e usa a mesma sessão first-party. Não alterado schema nem permissões.

Purchase: motor de envio, webhook, fila e payload não foram alterados nesta revisão. Compra permanece exclusivamente no servidor após confirmação de pagamento, sem frete e com desconto. Não dispara por Lead, abrir produto ou criar pedido. Identificador estável por pedido e fila idempotente. Revogação cancela eventos pendentes conforme lógica existente.

Validação automatizada: Lead após consentimento, uma vez por sessão mesmo após reload; PageView/ViewContent/AddToCart/InitiateCheckout continuam usando o mesmo Pixel; nenhum Purchase no navegador; pagamento confirmado enfileira uma vez; valor e deduplicação; CAPI testa events_received=1 com HTTP simulado e identificadores pessoais transformados em hash; endpoint de teste impede envio em modo real. TypeScript e lint aprovados.

Limite de comprovação: na consulta de produção havia zero pedidos pagos da loja e zero eventos reais na fila. Portanto esta revisão confirma configuração e comportamento por testes, mas não comprova entrega de uma compra real ao Gerenciador de Eventos da Meta. Não foram feitas compras, conversões falsas em modo real ou acesso às credenciais de terceiros.
