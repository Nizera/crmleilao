# Correção de valores após postagem

## Diagnóstico confirmado em consulta autenticada, somente leitura

A API mantém o preço da emissão em `price` e retorna a aferição em `service_posted.total_with_discount`. No envio E7B42D404: emissão R$ 31,73, postagem R$ 37,78, diferença +R$ 6,05. O banco ainda tinha R$ 31,73 e nenhuma alteração registrada. Também foram observadas reduções em outras etiquetas. Desconto isolado e `total_without_discount` não representam o valor final a registrar.

Esse envio está postado. A fila de preparação o exclui corretamente, mas o resumo inclui as etiquetas postadas da data. Isso explica o total de uma etiqueta com fila vazia. O novo botão "Ver todas as etiquetas" abre o histórico da mesma data e busca. O histórico mostra o valor emitido, o atual e a diferença. A paginação é corrigida quando um filtro reduz a quantidade ou a API informa intervalo fora dos resultados.

## Implementação

- Consulta manual e webhook autenticado usam o mesmo extrator de preço de postagem. Campo ausente, inválido ou zero provisório usa fallback; uma resposta transitória sem aferição não desfaz um ajuste previamente observado.
- A resposta de order/info precisa corresponder ao identificador consultado e a requisição tem timeout. Valores enviados diretamente no webhook continuam ignorados.
- O gatilho já implantado da migration 0057 mantém a emissão original, calcula a diferença e grava o histórico sem repetir uma alteração idêntica.
- Conciliação diária reutiliza o cron existente e seu segredo: até 60 etiquetas postadas/entregues dos últimos 120 dias, em blocos de três e com orçamento de até 12 segundos. As menos recentemente conferidas têm prioridade. Dados conferidos há menos de 12 horas são pulados. Falha de um provedor não impede conferir as demais etiquetas, nem falha a conciliação de compras/rifas.
- Não há alteração do valor pago pelo cliente, do saldo da carteira SuperFrete, do valor declarado ou dos lotes. Não há emissão/cancelamento de etiqueta no reconciliador.

## Implantação e limites

Não exige migration, variável nem outro agendamento. A implantação precisa ser seguida de sincronização dos envios anteriores para preencher ajustes que ainda não foram capturados. A rotina diária é uma reconciliação complementar; não significa atualização instantânea se a SuperFrete publicar um ajuste sem evento. O webhook continua sendo o caminho imediato.

As consultas de diagnóstico não modificaram produção. Testes incluem valores de aumento/redução observados, fallback, retorno explícito ao original, paginação, escopo e falhas da conciliação, validação da identidade da etiqueta e timeout.

## Validação concluída

145 testes gerais e 10 testes de fretes aprovados; build de produção, TypeScript e lint dos arquivos alterados aprovados. Diagnóstico do envio de referência reconfirmado em 05/11, sem mudanças no banco de produção.
