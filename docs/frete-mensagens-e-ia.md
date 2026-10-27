# Frete, faturamento diário, mensagens e análise de fotos

## Publicação

Aplicar `0029_mandatory_period_freight.sql` e `0030_customer_message_templates.sql`, depois das migrations anteriores, e publicar a versão correspondente. A 0030 substitui os três modelos de WhatsApp existentes pela padronização solicitada; continuam editáveis em Configurações.

## Frete obrigatório

- Ciclo pela data do leilão: terça inclusive até a próxima terça exclusiva, no calendário de São Paulo. Segunda pertence ao ciclo que começou na terça anterior.
- O primeiro lote não cancelado ainda aguardando pagamento/separação determina o vínculo do frete do ciclo. O servidor inclui os fretes devidos no Pix; não existe opção do cliente para retirá-los.
- Cada ciclo custa R$ 20. Ciclos anteriores ainda devidos, com lotes não enviados, são somados no mesmo Pix. Um índice único e uma reserva no banco impedem duplicar a cobrança ativa do mesmo ciclo.
- Cobranças existentes com frete são preservadas e mapeadas por ciclo. Lotes já enviados/entregues não geram cobrança retroativa. Pix antigos emitidos sem frete não podem ter o valor alterado no Mercado Pago: devem ser cancelados/verificados e refeitos para incluir tudo.
- Os valores do frete não entram nos gastos em lotes, Caracoins de lotes ou declaração de conteúdo.
- A emissão e o pagamento da etiqueta verificam lotes pendentes, cobranças abertas e fretes devidos. O aviso ao cliente é liberado após a emissão; consulta a SuperFrete caso o código ainda não tenha sido gravado. Se a transportadora ainda não o liberou, a mensagem informa isso e leva ao painel, sem inventar um rastreio.

## Dashboard

“Faturamento do dia” soma `arremate_value` dos lotes criados no dia civil de São Paulo, excluindo cancelados. O fechamento continua mostrando recebimentos pela data do pagamento. Indicadores mensais/acumulados permanecem baseados em pagamentos.

## WhatsApp

- Aviso de arremates: mensagem reutilizável por cliente, direcionada ao painel, sem número de lote.
- Cobrança: consulta o total atual de lotes pendentes mais fretes devidos/reservados, sem somar compras da loja. O link leva ao painel para conferir e pagar o valor atualizado.
- Envio: período dos lotes vinculados, confirmação de etiqueta emitida, rastreio e acesso ao painel. Não afirma postagem antes da transportadora confirmar.
- Os botões preparam a conversa no WhatsApp. Não enviam mensagens automaticamente nem dispensam a ação da equipe.

## Gemini opcional

Variáveis somente de servidor: `GEMINI_API_KEY` e `GEMINI_MODEL` (modelo que suporte imagens e JSON estruturado). Nenhuma chave deve usar prefixo `NEXT_PUBLIC_`. Não há novo SDK ou envio automático de fotos.

O botão “Analisar com IA” envia ao Google até três fotos e apenas o catálogo de jogadores/cores. Não envia cliente, telefone, pagamentos ou quantidade de estoque. Há limite de 8 análises/hora por membro, timeout de 40 segundos e validação de formato/tamanho. Fotos já salvas são conferidas contra o lote antes de baixar do storage; não se aceita URL arbitrária.

Falhas temporárias HTTP 500/502/503/504 têm até duas novas tentativas automáticas com espera progressiva, dentro do mesmo limite total de 40 segundos. Uma análise pode, portanto, fazer até três requisições ao provedor e consumir a cota correspondente. Erros de chave, modelo, permissão e cota (400/401/403/404/429) não são repetidos automaticamente.

O resultado é validado contra os IDs reais do estoque e mostrado como sugestão. Itens incertos são sinalizados; a equipe pode corrigir jogadores, cores e quantidades antes de “Aprovar e aplicar itens”. Alterar as fotos invalida a aprovação da sugestão anterior. O lote só é salvo pelo formulário normal e a baixa de estoque continua na movimentação para a caixa.

Sem as variáveis, o cadastro manual continua disponível. Nenhuma chamada real ao Gemini ou compra de etiqueta é necessária para compilar. A qualidade do reconhecimento deve ser avaliada com fotos representativas após configurar o provedor.

Documentação oficial consultada: [imagens](https://ai.google.dev/gemini-api/docs/image-understanding) e [JSON estruturado](https://ai.google.dev/gemini-api/docs/generate-content/structured-output).

## Verificação isolada

`node --test scripts/freight.test.mjs` executa casos em PostgreSQL em memória: ciclos de terça/segunda, primeiro lote obrigatório, bloqueio de Pix sem frete, múltiplos ciclos no mesmo Pix, repetição da reserva, sincronização de aprovação e permissões. Não acessa produção ou Mercado Pago.
