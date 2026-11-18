# Correção da renovação de sessão — 18/11/2026

Relato: falha de carregamento em relatórios e lotes, resolvida pelo operador com novo login. A captura é uma falha de carregamento do navegador e não permite identificar sozinha o erro HTTP.

Defeito confirmado no código: NextResponse.next({ request }) captura os headers de entrada antes da renovação. O callback setAll atualizava request.cookies e Set-Cookie na resposta antiga, mas os headers x-middleware-request-cookie permaneciam com a sessão anterior. A tela podia tentar renovar novamente um token já rotacionado. Além disso, a integração não propagava os cache headers entregues pelo SDK @supabase/ssr.

Correção: reconstruir NextResponse depois de atualizar os cookies de entrada; preservar escritas anteriores e atributos dos cookies; devolver essa mesma resposta no proxy; preservar Cache-Control, Expires e Pragma em redirecionamentos. Mantém getUser validado no Auth, perfis e RLS. Nenhuma extensão artificial da sessão nem bypass de autenticação.

Logs: cinco refresh_token_not_found no intervalo padrão de 24h. Não foi possível atribuí-los à pessoa da captura. Esses registros são compatíveis com problemas de renovação, mas não provam a causa daquele episódio específico.

Validação: vinte testes de autenticação, cookies rotacionados na mesma requisição para /admin/lotes e /admin/relatorios, múltiplas escritas, atributos/cabeçalhos preservados, sessão inválida indo ao login, isolamento e login por e-mail. TypeScript e lint concluídos sem erro. Não foram criadas sessões, senhas, pagamentos ou dados de teste em produção.

Referência: https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs
