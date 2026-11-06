# Pagamento dos lotes em 24 horas

## Implantação

1. Aplicar `0062_auction_payment_deadlines.sql` no Supabase. A política retroativa original foi substituída pela migration 0063: aplicar também `0063_future_lots_only_deadlines.sql`. Os lotes antigos permanecem sem prazo automático.
2. Publicar a aplicação.
3. Executar `supabase/releases/auction-payment-deadlines-scheduler.sql`. Usa pg_cron/pg_net e o segredo já existente no Vault `ocdl_raffle_cron_secret` (mesmo CRON_SECRET da Vercel). Não precisa criar nem enviar outro segredo.

O agendamento verifica a cada minuto se há avisos ou vencimentos a processar. Apenas nesse caso chama a aplicação. Não usa o agendador pago da Vercel.

## Regras

- Apenas lotes com valor positivo e pagamento pendente. Prêmios e pendências de R$0 ficam fora.
- Lotes novos: cadastro +24h, com aviso no painel. Lotes anteriores à ativação: sem prazo ou cancelamento automático. Editar esses lotes não inicia a contagem.
- Avisos no sino após 12h e nas últimas 2h. Se a verificação perdeu o aviso de 12h, envia somente o das últimas 2h. Repetir o processamento não duplica o aviso.
- Painel, Pix, listagem e detalhe mostram o prazo. Não são enviados WhatsApp, e-mail ou push externo por esta implementação.
- No vencimento, confere e encerra o Pix no Mercado Pago antes de cancelar. Um Pix com lotes de idades diferentes é encerrado inteiro; os lotes ainda no prazo continuam pendentes para outro Pix.
- Pagamento confirmado é preservado, inclusive se chegar durante a tentativa de encerramento. Timeout, processamento bancário, divergência ou falta de identificação mantêm a reserva para nova verificação. O painel informa que o prazo encerrou e o pagamento está sendo conferido.
- Resposta perdida na criação do Pix mantém o registro e a referência idempotente para recuperação; não gera outra cobrança independente.
- Cancelamento automático marca o lote com `payment_expired_at`; não apaga dados. Sai das telas do cliente e dos indicadores do dashboard; continua disponível para auditoria administrativa, identificado como prazo encerrado.
- Não movimenta estoque ao vencer. Se houver indício de estoque já movimentado ou envio ativo, mantém o lote para conferência em vez de remover um item físico.
- O prazo não é reiniciado por editar título, observação ou imagem. Reabrir administrativamente um lote para pendente gera novo prazo de 24h.

## Limites operacionais

A conclusão pode levar o intervalo do agendamento e o tempo de confirmação do provedor. Não é seguro afirmar que um pagamento deixou de existir apenas porque o relógio chegou a zero. Falhas retornam 503 e os candidatos são tentados novamente após uma reserva de processamento de dois minutos.
