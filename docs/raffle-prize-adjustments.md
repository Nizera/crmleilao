# Ajustes das cotas premiadas — 07/11/2026

- Cotas premiadas encontradas exibem nome riscado, fundo discreto e selo “Encontrada · indisponível”, preservando os números ocultos.
- Campanhas abertas/pausadas com prêmios ainda não encontrados atualizam a consulta a cada 30 segundos enquanto a aba está visível e não há operação em andamento.
- Na administração, cada prêmio instantâneo tem edição do nome e exclusão. As vendas precisam estar pausadas ou em rascunho; prêmios reservados ou encontrados ficam protegidos também no banco. Número e fotos não mudam ao editar o nome. A exclusão remove somente o prêmio, não o número da campanha.
- A edição compara o nome original para impedir sobrescrita de outra alteração. Todas as operações registram auditoria.
- Resumo sem seleção vira uma orientação estática. Com seleção, total e botão ficam lado a lado, com uma linha curta sobre o prazo. Mantidos os nomes acessíveis completos dos botões.

Aplicar `supabase/migrations/0067_raffle_prize_edit_delete.sql` antes de usar edição/exclusão. A função da migration 0067 foi confirmada disponível no banco. Publicação autorizada pelo usuário em 07/11/2026.

Validação: quatro testes passaram (incluem permissões, reserva/ganhador, edição preservando número/fotos, conflito de versão, exclusão e renderização de avisos/resumo vazio e selecionado). Build de produção e lint passaram; TypeScript novamente conferido após o ajuste de atualização periódica. Testes SQL usam banco isolado, sem alterar prêmios de clientes.

Revisão de publicação: 72 testes passaram, build de produção, TypeScript e lint passaram. Botões bloqueados agora explicam o motivo; a aba de cotas inclui o comando Pausar vendas. Nenhuma compra real foi criada ou modificada nesta validação.
