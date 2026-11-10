# Advertências e recuperação de lotes

- O cancelamento automático de lotes por vencimento gera uma única advertência por cliente e dia de leilão (`auction_date`), independentemente da quantidade de lotes ou da data/hora em que expiram. Não há contagem retroativa.
- Pendências de três dias diferentes de leilão bloqueiam o acesso autenticado do cliente. Páginas públicas continuam públicas.
- A expiração continua usando o agendamento existente. Não é necessário um novo cron.
- O cliente vê a contagem no painel. Ao atingir três, recebe a tela de bloqueio e deve procurar a equipe.
- Em Clientes → ficha do cliente → Advertências e acesso, a equipe pode aplicar advertência manual ou liberar/reiniciar a contagem, sempre com motivo. Perfis somente leitura não podem alterar.
- A liberação reinicia a contagem em zero; o histórico de eventos permanece na ficha.
- Recuperar um lote é uma ação independente: reabre o pagamento por 24 horas e não remove a advertência anterior, nem libera uma conta bloqueada. Expirar novamente um lote do mesmo dia não duplica a advertência, inclusive após a liberação administrativa.
- Sessões já abertas não autorizam novas operações: `requireCustomer` verifica o estado atual e `current_customer_id()` deixa de autorizar dados privados e compras. Pagamentos já enviados ao provedor continuam sendo conciliados pelos webhooks.
- A implementação não altera saldo, prêmios ou pagamentos confirmados, e não cancela cobranças apenas por bloquear o cliente.

## Ativação

Executar `supabase/migrations/0074_customer_warnings.sql` e `0075_customer_warnings_per_day.sql` antes de publicar o código que consulta as novas tabelas. Se a 0074 já foi aplicada, executar somente a 0075. Confirmar as migrations e publicar na sequência. A 0075 não reconta advertências históricas.

## Validação

`node --test scripts/customer-warnings.test.mjs scripts/lot-recovery.test.mjs scripts/auction-future-only.test.mjs`

Testa expiração sem retroatividade, deduplicação, terceiro aviso, sessões bloqueadas no banco, proteção contra desbloqueio pelo próprio cliente ou perfil de leitura, liberação auditada e novo vencimento após recuperação.
