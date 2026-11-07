# Revisão de segurança e publicação — rifas públicas — 07/11/2026

## Resultado

72 testes passaram, sem falhas ou testes ignorados. Compilação de produção, TypeScript e lint passaram. Os testes usam dados isolados e pagamentos simulados. Nenhum pagamento, reserva ou prêmio de produção foi alterado para validar esta publicação.

## Pontos conferidos

- Funções públicas projetam somente dados de catálogo/campanha; rascunhos e campanhas arquivadas não aparecem. Números de prêmios ocultos permanecem nulos. O teste SQL com papel anon não consegue ler pedidos.
- Consulta anônima real retornou catálogo e campanha e não retornou custos internos. A consulta de pedidos anônima permaneceu protegida.
- Login aceita somente destinos internos permitidos; URLs externas, redirecionamentos com barra invertida e caminhos administrativos são rejeitados.
- Compras e reservas continuam autenticadas e validadas no servidor. Seleção em sessionStorage não reserva estoque/cotas nem cria pagamento. IDs e preços fornecidos pelo navegador são novamente conferidos.
- Reserva serializada no banco e restrições de unicidade impedem vender o mesmo número duas vezes. Repetições de solicitação usam chave de idempotência.
- Pagamento exige consulta autenticada ao provedor com referência e valor compatíveis. Repetições não duplicam prêmios. O término do relógio não libera cotas antes da confirmação do cancelamento.
- Prêmios reservados ou encontrados não podem ser editados ou excluídos. Campanha deve estar pausada/rascunho. O bloqueio vale na função SQL, não apenas na interface. Registro de auditoria preservado; atualização de nome compara a versão anterior.
- Novos botões explicam o motivo quando bloqueados e oferecem Pausar vendas na própria aba. A revisão não pausou nenhuma campanha automaticamente.
- O aviso Encontrada/indisponível não revela o número oculto. A consulta se atualiza a cada 30 segundos quando a aba está visível, enquanto ainda houver prêmios a encontrar e sem operação de reserva em andamento.
- Resumo compacto mantém texto acessível completo do botão e apresenta orientação em vez de um bloco de compra vazio.

## Limites

Testes de pagamento usam provedor simulado. Não foi feita nova compra real ou teste de recebimento de webhook nesta revisão. A leitura privada de metadados via REST anônimo respondeu 401; não foi usada para afirmar permissões de execução em produção. A restrição de escrita é conferida pelos testes SQL/guards e pela consulta anônima de dados.

A execução atual do job privado do Supabase não é comprovada pelo acesso REST disponível; a revisão anterior deixou a consulta `supabase/releases/raffle-readonly-check.sql` para essa conferência. A expiração depende da agenda, da disponibilidade da aplicação e da confirmação do Mercado Pago. Esta publicação não altera o agendamento nem as credenciais.

Logs locais: `raffle-public-security-final-tests.log` e `raffle-public-security-final-build.log`.
