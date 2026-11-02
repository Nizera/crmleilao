# Rifas — primeira versão local

Implementação de 01/11/2026. Não publicada e sem alterações executadas no banco compartilhado.

## Preparação

1. Aplicar `supabase/migrations/0043_raffles.sql` após as migrations existentes até 0042. A migration exige a fila logística da 0035.
2. Acessar `/admin/rifa`, criar um rascunho e cadastrar os prêmios. Não liberar compras durante a conferência inicial.
3. Publicar a campanha para consultá-la em `/painel/rifas`. Publicação e liberação de compras são controles separados.
4. Somente o perfil `owner` pode liberar compras em `/admin/rifa/configuracao`. **A configuração pertence ao banco compartilhado, não apenas ao localhost.** A tela avisa isso antes de confirmar.
5. Usar as mesmas variáveis do Mercado Pago e o mesmo webhook assinado já existentes. Não há outra credencial de pagamento para rifas. Confirmar configuração de assinatura antes de qualquer venda real.

Atualização: a migration `0044_raffle_optional_shipping_date.sql` torna a previsão de envio opcional. Quando ela estiver vazia, o prêmio entra na fila de separação na data da conquista, no horário de São Paulo. A campanha permanece sem previsão; datas informadas continuam sendo respeitadas.

## Fluxo entregue

- ADM: campanhas por status, criação de rascunhos, capa enviada ao Storage, regulamento, regras de apuração, quantidade/preço, mínimos e máximos, prêmios principais e cotas premiadas aleatórias.
- Cliente: seletor Leilão/Loja/Rifas, campanhas, seleção manual ou automática, resumo, reserva, Pix, confirmação automática, Minhas cotas e Meus prêmios.
- Apuração: sorteador externo ou Loteria Federal. O sistema registra o resultado informado pela equipe; não executa sorteio nem calcula automaticamente a extração federal.
- Resultados principais exigem pausa nas vendas, ausência de reservas abertas/em análise, cota paga, explicação e link HTTPS. O resultado não pode ser sobrescrito por este fluxo.
- Prêmios de cotas são atribuídos exclusivamente a números livres. A adição exige rascunho ou pausa. Não permite mudar o prêmio de uma cota já reservada/vendida.
- A revelação de uma cota premiada ocorre após pagamento, no pedido confirmado. Também fica em Meus prêmios, inclusive se o comprador saiu da tela antes da confirmação.
- Reservas no ADM têm busca por nome, telefone, pedido ou número, filtro por campanha/status e paginação de 20 itens. O total considera o filtro inteiro.

## Logística

`raffle_awards` vincula prêmio, campanha, cota, reserva, cliente e uma única entrada em `logistics_pending`, com origem `raffle`.

- Cota premiada: a confirmação do pagamento gera o prêmio e a entrada de separação na mesma transação.
- Prêmio principal: o registro do vencedor gera os mesmos vínculos.
- O relatório identifica **Prêmio de rifa**, campanha e cota. Usa o botão existente de colocar na caixa; não cria arremate nem soma o valor do prêmio ao faturamento do leilão.
- Com a 0046, a equipe informa o valor declarado do prêmio ao colocá-lo na caixa. Esse valor compõe declaração/seguro do pacote, mantendo arremates, faturamento e pontos separados. O vínculo compara IDs e valores com o conteúdo declarado; mudança durante a emissão aborta o vínculo.
- A fila logística existente faz o vínculo ao pacote, preserva o histórico e devolve o item à fila quando a etiqueta é cancelada.
- O cliente consulta a situação da caixa, envio e código de rastreio em Meus prêmios.
- Nenhum prêmio debita estoque de jogador automaticamente: não há vínculo de SKU nesta primeira versão. A fila funciona como os itens logísticos avulsos.
- A 0048 implementa envio exclusivo de prêmio com frete por conta da empresa, conforme definição do usuário. O prêmio aparece na fila administrativa sem exigir lote ou compra da loja. Não cria cobrança nem consome crédito de frete do cliente; a empresa paga a etiqueta normalmente à SuperFrete.
- Quando o prêmio segue junto de lotes ou produtos da loja, continua valendo o frete normal do pacote. O banco recusa omitir um lote pago elegível ou marcar pacote misto como exclusivo de prêmio para isentá-lo.

## Segurança e pagamentos

- RLS: cliente consulta apenas suas reservas. Tabelas de números atribuídos, prêmios secretos e eventos não permitem consulta direta de participantes. O servidor devolve apenas os campos necessários.
- Mesmo com a interface desabilitada, o banco recusa novas reservas quando a chave global está bloqueada.
- Toda escrita operacional passa por funções com verificação de identidade/perfil. `viewer` não cria campanhas, prêmios ou resultados. Apenas `owner` controla a liberação global.
- A campanha é bloqueada durante a reserva; a chave primária `(campaign_id, number)` impede dupla atribuição. Uma reserva aberta por cliente/campanha limita bloqueio repetido de cotas.
- Chave idempotente por cliente/pedido e referência estável no Mercado Pago impedem criar outra cobrança ao retomar a mesma reserva.
- Webhook usa a validação já existente e consulta autenticada da Orders API. Valor, referência e identificação do pagamento são conferidos antes da liquidação.
- Repetir confirmação não cria outro prêmio ou outro item logístico.
- Não se liberam cotas pelo relógio do navegador. Só cancelamento, falha ou expiração confirmados pelo provedor liberam os números.
- Pagamento confirmado depois de uma liberação anterior entra em análise e não toma uma cota de outro comprador.
- Estorno/chargeback coloca o pedido em análise, retém cotas e bloqueia o pagamento da etiqueta mesmo quando o prêmio já está vinculado. Cancelar a etiqueta preserva o bloqueio do prêmio. Prêmio já enviado exige tratamento humano; não há recolhimento automático nem novo sorteio.
- A 0047 adiciona conferência de estorno integral em Reservas. Só a equipe com escrita pode iniciar; o servidor consulta o Mercado Pago e confere ID, referência e valor. Estorno parcial, chargeback ou pagamento tardio ainda aprovado permanecem em análise. A ação não reembolsa ninguém. Etiqueta deve ser cancelada antes da resolução; prêmio principal apurado exige intervenção manual. Cotas de prêmios instantâneos já revelados permanecem retidas; as demais são liberadas, com evento de auditoria.
- Após registrar um prêmio principal, novas vendas e reabertura são recusadas pelo banco.
- Polling do cliente visível confirma pagamentos em andamento. O ADM pode consultar pendências; o cron diário existente também reconcilia as rifas dentro do orçamento de execução restante. Isso complementa o webhook, sem prometer atualização em tempo real por cron.
- As compras de rifas não geram Caracoins, não alteram elo e não entram em métricas do leilão/loja.

## Limites desta versão

### Prêmios da plataforma anterior cadastrados como lotes de R$ 0 (0050)

- Na fila de Envios, o menu de três pontos traz Liberar frete. A equipe informa o motivo e libera somente os registros de R$ 0 selecionados daquele cliente, sem Pix ou envio ativo.
- A liberação registra operador/data/motivo e permite o pacote exclusivo desses prêmios com frete por conta da empresa. Não cria cobrança, pagamento de frete fictício ou crédito no dashboard; créditos pagos do cliente são preservados.
- Registros zero aguardando pagamento passam para disponível/pago sem gravar data de pagamento. A regra de pontos existente não credita moedas para valor zero.
- Lote com valor, lote de outro cliente, registro em Pix, pacote misto e alteração posterior do valor não ganham isenção por essa ação. Pendências financeiras continuam verificadas antes da etiqueta.
- Aplicar `0050_external_prize_freight_release.sql` após as migrations anteriores, incluindo 0048. Não aplicada automaticamente nesta revisão.

### Arquivamento e exclusão (0049)

- Aba Arquivadas no ADM e ações na lista/detalhe. Arquivar pausa vendas abertas e retira a campanha da vitrine; reservas, pagamentos, prêmios e logística continuam preservados.
- Restaurar não reabre vendas automaticamente. Rascunhos voltam como rascunho, encerradas como encerradas e campanhas antes abertas voltam pausadas.
- Somente o dono exclui rascunhos sem nenhuma reserva ou prêmio conquistado. Até reservas canceladas impedem exclusão. SQL trava a campanha e mantém auditoria independente após excluir.
- A migration `0049_raffle_archive_delete.sql` é adicional ao pacote 0045–0048. Aplicá-la antes de usar a nova interface. Não foi executada no banco compartilhado pela revisão.

- De 2 a 10.000 cotas/campanha, com numeração a partir de zero e pelo menos três dígitos. Até 1.000 por compra e 200 prêmios/campanha.
- Grade em páginas de até 100 números, reservas de 20 e histórico do cliente de 10 por página. Prêmios pessoais paginados em 20; o resumo do pedido busca os prêmios daquele pedido, independentemente da página do histórico.
- Usa o prazo atual do Pix da integração: até **3 dias**. Expiração personalizada de 10 minutos não foi implementada.
- Preço, tamanho da campanha e regulamento são fixos após a criação nesta versão. Ainda não há editor do rascunho, promoções por pacote, galeria de várias fotos, ranking de participantes ou página pública sem login.
- Não importa campanhas antigas e não oferece aprovação manual de comprovante como confirmação de pagamento.
- Revisões financeiras não têm botão de liberação forçada: exigem conferência da equipe.

## Validação

`npm run test:raffles` executa a migration real em PostgreSQL embarcado descartável (PGlite), com papéis separados. Verifica acesso negado, isolamento, números ocultos, zero válido, valores inválidos, seleção automática, idempotência, colisão de cotas, valor divergente, liquidação, prêmio/logística únicos, expiração, pagamento tardio, resultado e estorno.

Nenhum teste faz compra, transferência, sorteio ou chamada ao Mercado Pago. PGlite não substitui teste de carga com múltiplas conexões PostgreSQL, nem o teste integrado do Pix e de emissão de etiqueta em ambiente controlado. A interface com dados reais ainda depende da aplicação das migrations novas. A validação visual isolada dos componentes e os resultados atualizados estão em `validacao-loja-rifas-2026-11-01.md`.


## Apuração e fotos do prêmio principal

1. Pause as vendas da campanha e resolva as reservas ainda abertas.
2. Na aba Apuração, informe a cota vencedora paga, os detalhes e o link HTTPS do resultado externo.
3. Confirme o registro. O dono da cota recebe o prêmio em Meus prêmios, e o mesmo prêmio entra na fila de separação. O registro não pode ser sobrescrito.
4. Na aba Fotos, envie até seis imagens; a primeira é a capa. Salve antes de sair. O ganhador pode ampliar as imagens em Meus prêmios. As imagens são da campanha e são compartilhadas entre seus prêmios.

A migration 0052 adiciona apenas a galeria e uma função restrita à equipe com escrita, com auditoria. Não altera cotas, pagamentos ou ganhadores. As campanhas antigas continuam usando a capa. A apuração permanece externa; o app registra o resultado informado pela equipe.
