# Filtro de campanhas no dashboard da rifa

Na visão geral, Selecionar campanhas abre uma janela com busca e múltipla seleção. Inicialmente prioriza as campanhas com todas as cotas pagas. A opção pode ser desmarcada para incluir campanhas em andamento, rascunhos e histórico, incluindo arquivadas.

Aplicar filtro usa parâmetros repetidos campaign na URL. Nenhuma seleção significa todas as campanhas. UUIDs são normalizados, duplicatas removidas e há limite de 100 campanhas por seleção. Seleção inválida nunca amplia silenciosamente o resultado para todas: aparece um aviso e os indicadores não incorporam os IDs inválidos.

Campanhas, recebimentos líquidos (1% de dedução), cotas pagas, reservas, prêmios a separar, gráfico e contagem de pausadas usam a seleção. O período financeiro usa a data do pagamento; reservas e prêmios usam suas datas de criação. Situações de campanha são atuais e a tabela exibe o total acumulado de cotas da campanha, conforme a legenda. Links gerais de navegação continuam levando às respectivas áreas de gestão.

Há períodos de 7, 30, 90 dias e Todo o histórico. O seletor mostra até 500 campanhas recentes e informa quando esse limite foi atingido. O limite anterior de leitura dos indicadores continua protegendo contra a exibição de totais parciais.

Nenhuma migration ou alteração de pedidos é necessária. Build, TypeScript, lint e cinco testes passaram, incluindo seleção, normalização, limites, não ampliação indevida e cálculo líquido. Publicação feita no contexto dos ajustes finais autorizados do dashboard.
