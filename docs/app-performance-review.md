# Revisão de desempenho do app — 18/11/2026

Alterações locais. Sem deploy, alterações de credenciais, migrations ou gravações de dados reais de teste.

## Escopo revisado

Autenticação, layouts, home e lotes do cliente, Pix e sincronização de pagamentos, loja pública e autenticada, dashboard e consultas do admin, cobranças, envios e relatórios. Loja, estoque, vouchers, fidelidade e rifas passaram pela bateria existente de regressão. Não foi medido o tempo de cada tela com sessão autenticada.

## Alterações

- Cliente Supabase compartilhado somente dentro do render da requisição via React cache, sem cache persistente de sessões ou dados privados. Guardas reutilizam getAuthUser, mantendo getUser validado no servidor, RLS, perfil e bloqueio do cliente.
- Home mantém o histórico completo para KPIs, mas busca fotos e descrições somente para lotes do dia e pendentes; pendências antigas não desaparecem. Os metadados visuais são consultados com customer_id explícito e paginação de 500, sem teto de resultados. Fotos e descrição de históricos continuam disponíveis na listagem e detalhe.
- O componente de pagamento da home recebe somente lotes pendentes; totais de todos os lotes continuam calculados no servidor. O Pix consulta somente pendências e o filtro de pagos aguardando envio é aplicado no banco.
- Lista de lotes memoriza galeria e caminhos das fotos; digitação da busca usa atualização diferida, preservando busca por código, nome e descrição.
- Dashboard inicia leituras independentes em paralelo e executa dois grupos de IDs por consulta de escopo simultaneamente. Paginação, ordem e tratamento de falhas preservados. Não apresenta resultados parciais como totais completos.
- Envios carrega fila e primeira página de etiquetas em paralelo; origem e status do webhook são lidos simultaneamente. Todas as páginas continuam carregadas.
- Gráficos do dashboard carregam sua biblioteca quando próximos da área visível, com altura reservada. KPIs e tabelas não esperam pelos gráficos.
- Expiração de pagamento usa timer para o prazo, sem intervalo de um segundo por cartão; corrige o estado ao voltar à aba e cancela timers no descarte. Contagens regressivas visíveis continuam funcionando.
- Cobranças do admin pausam refresh automático em aba oculta e atualizam no retorno.
- Estados de carregamento adicionados ao admin e painel para feedback imediato na navegação.

## Validação

- npm run test:release: 155 testes, todos passaram (pagamentos, loja, estoque, vouchers, Caracoins, rifas, frete, permissões e isolamento).
- Testes dirigidos de analytics, paginação de envios, pagamento e autenticação passaram; três testes próprios cobrem histórico com 1.103 lotes, mais de mil fotos de lotes visíveis sem truncamento, preservação de totais, concorrência limitada e cancelamento de timers.
- TypeScript e ESLint dos arquivos alterados: passaram.
- npm run build: concluído, compilação otimizada e geração de rotas passaram.
- Verificação HTTP local: landing 200; loja 200; catálogo 200 com consulta de aproximadamente 452 ms; acessos anônimos ao admin e painel continuam redirecionando ao login (307). Esses tempos são de desenvolvimento local durante checagens e não são comparáveis a LCP/INP/CLS ou a produção.

## Limites e próximos passos

Não atribuir porcentagem de ganho ou tempo garantido ao painel/admin: falta medição com sessões autenticadas em celular e rede móvel. Recebimento do Pixel pela Meta e entrega do Broadcast com cadastro real continuam sem teste de ponta a ponta.

O dashboard mantém a leitura completa de lotes para preservar indicadores históricos; agregação SQL e índices de banco podem ser uma etapa futura após EXPLAIN com volume real. Não troquei os cálculos financeiros por agregações novas sem essa evidência. Histórico de lotes e relatórios completos continuam disponíveis, portanto contas muito grandes podem exigir paginação/virtualização posteriormente. Nenhuma função foi removida para reduzir carga.
