# Reserva de cotas por dez minutos

O prazo é contado pelo banco desde a criação da reserva, sem prorrogação ao abrir ou atualizar a tela. O Pix deixa de aparecer após esse prazo. O servidor consulta o pagamento e solicita seu cancelamento; somente a confirmação autenticada do Mercado Pago libera os números. Pagamento já confirmado é preservado, inclusive se ocorrer durante a tentativa de cancelamento. Falhas do provedor mantêm a reserva retida e geram nova tentativa.

O Mercado Pago exige ao menos 30 minutos para o vencimento nativo do Pix nesta integração. Por isso, rifas usam Pix com prazo nativo de 30 minutos e cancelamento antecipado pelo app após os dez minutos de reserva. Pix de lotes e da loja mantêm o prazo atual.

## Ativação

1. Executar o arquivo completo `supabase/migrations/0056_raffle_reservation_ten_minutes.sql`. Reservas que já existirem recebem dez minutos de transição a partir da aplicação; nenhuma cota é liberada apenas por essa atualização.
2. Publicar o código. O endpoint `GET /api/cron/raffle-expiration` deve estar disponível em produção e exige o `CRON_SECRET` já cadastrado na Vercel.
3. No Supabase, habilitar as extensões `pg_cron` e `pg_net` e cadastrar no Vault um segredo de nome `ocdl_raffle_cron_secret`. O valor deve ser exatamente o `CRON_SECRET` da Vercel. Não enviar o valor por chat nem adicioná-lo ao repositório.
4. Executar o arquivo completo `supabase/releases/raffle-expiration-scheduler.sql`. Ele agenda uma verificação por minuto e só chama o servidor se houver reservas vencidas em aberto. Pode ser executado novamente para atualizar o mesmo job.

Essa agenda roda no Supabase e não depende da frequência de cron disponível no plano da Vercel. O cron diário existente continua como reconciliação complementar; sozinho ele não garante a rotina de dez minutos.

## Verificação operacional

- Em Supabase Cron, conferir se `ocdl-raffle-expiration` está ativo com agenda `* * * * *`.
- Os registros HTTP precisam indicar sucesso quando houver reservas vencidas. Um pedido HTTP enfileirado não prova que o cancelamento foi concluído.
- A conferência é feita a cada minuto, com lotes limitados por execução. A devolução efetiva das cotas depende do próximo ciclo, da carga e da resposta do Mercado Pago; não é prometida liberação no milissegundo exato do prazo.
- Sem segredo, com segredo diferente ou sem a agenda, a automação fica incompleta. O app mantém os números retidos e permite reconciliação pela página de reservas e pelo painel administrativo.
- Em caso de falha ou pagamento concorrente, não apagar reservas nem liberar números manualmente sem conferir o provedor.

## Segurança e testes

O endpoint recusa pedidos sem autenticação. O agendamento usa Vault e restringe os papéis do app nas tabelas da fila HTTP. Administradores com acesso direto ao banco continuam dentro da fronteira de confiança. Nenhum segredo é gravado neste arquivo ou nos scripts versionados.

Os testes usam respostas simuladas do provedor e verificam: prazo, Pix padrão preservado, Pix de rifa com 30 minutos, cancelamento confirmado, cancelamento pendente/falho, pagamento concorrente, divergência de valor, expiração no banco e autenticação da rotina. Não foi criado nem cancelado um pagamento real para validar este ajuste, nem foi ativado o job no banco pelo agente.

Referências: [Pix na Orders API](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/websites/pix), [Supabase Cron](https://supabase.com/docs/guides/cron/quickstart), [Vault](https://supabase.com/docs/guides/database/vault).
