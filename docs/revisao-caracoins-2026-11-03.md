# Revisão de entrega — Caracoins, vouchers e design

## Resultado

143 testes da suíte de release passaram. Build de produção e TypeScript passaram; lint dos arquivos alterados passou. Revisão visual realizada com componentes reais e dados fictícios, sem compras, com largura mobile de 390 px e desktop de 1280 px. Quatro imagens carregadas, sem estouro horizontal no mobile. Originais gerados por image_gen; WebP final totaliza aproximadamente 752 KB.

## Fronteiras verificadas

- Bônus somente após lote de valor positivo pago no banco, não por clique do navegador. Claim único por cliente, trava de cliente e ausência de crédito retroativo para compradores anteriores.
- Ranking e saldo separados: gastar ou expirar moedas não reduz o elo. Cancelamentos legítimos continuam revertendo a pontuação das compras e o bônus quando não restar compra paga.
- Valor de voucher validado em três camadas: formulário, Server Action autenticada com controle de perfil e rate limit, e constraint/trigger SQL. Desconto não ultrapassa R$ 20 nem o subtotal elegível; frete não é abatido. Um único voucher por pedido.
- Moedas vencidas excluídas da consulta de saldo. Gasto validado novamente dentro da transação, com expiração materializada e consumo FIFO, sem depender do cron ou do saldo do navegador.
- Resgate idempotente não debita novamente e não gera outro voucher. Saldo insuficiente provoca rollback. Expiração não se repete. Cancelamento após expiração não gera o mesmo débito duas vezes.
- Cliente não consulta saldo de outro cliente, não lê claims internos e não executa o sweep privado. Funções definer com search_path vazio, manutenção restrita a service_role. Cron protegido por comparação segura de CRON_SECRET já existente.
- Nenhuma variável de ambiente, credencial, imagem de cliente privada, dump ou CSV operacional incluído no commit.

## Implantação

Design aprovado publicado pelo commit d033dc2. Regras novas dependem de executar 0058_caracoins_policy.sql e depois 0059_caracoins_expired_reversal.sql no mesmo Supabase da produção. 0058 cadastra os quatro modelos e atualiza o modelo de R$ 10 sem alterar vouchers já emitidos. Não é necessário outro plano Vercel nem outro agendamento.

## Limites

Testes transacionais executados em PostgreSQL isolado por PGlite; não foram gerados pagamentos reais nem conduzidos scans ativos. Locks e restrições foram revisados, mas o ambiente isolado não reproduz contenção de múltiplas conexões de uma produção de grande escala. A nova política ainda precisa da aplicação das migrations no banco antes do smoke test de produção. Esta revisão não é garantia de ausência absoluta de vulnerabilidades.
