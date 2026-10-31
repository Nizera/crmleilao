# Acesso por e-mail — ativação

Implementação local pronta para confirmação por código do Supabase Auth, entregue pelo SMTP do Resend. Não usa uma chave Resend na Vercel.

## Antes de publicar

1. Aplicar `supabase/migrations/0036_customer_email_access.sql` no SQL Editor. Se houver e-mails repetidos, a migration para e faz rollback sem juntar ou excluir clientes. Corrigir os cadastros manualmente antes de repetir.
2. Authentication → Email Templates: substituir **Confirm signup** pelo conteúdo de `confirm-signup.html` e **Magic Link** por `magic-link.html`. Assunto sugerido: `Seu código de acesso — Os Caras das Legends`. Ambos precisam de `{{ .Token }}`: o fluxo é por código, não depende de abrir links.
3. Conferir SMTP do Resend: remetente `acesso@oscarasdaslegends.com.br`, nome Os Caras das Legends. Não colocar a chave em variáveis NEXT_PUBLIC nem no repositório.
4. Authentication → Providers/Sign In: permitir novos usuários e manter confirmação de e-mail habilitada. Conferir validade do OTP (recomendado 10 minutos) e intervalo entre envios (ao menos 60 segundos).
5. Vercel → Environment Variables: `CUSTOMER_EMAIL_ACCESS_ENABLED=true`. Precisa de novo deploy, pois a tela de solicitação é renderizada no build. Sem a variável, os envios e ativação ficam desligados e o convite continua funcionando.
6. Fazer teste real com um e-mail controlado pela equipe: entrega, código expirado, código repetido, criação, logout, login por e-mail e por telefone, recuperação. Não testar contas de clientes reais sem combinar com eles.

## Regras

- Convite continua disponível; senha existente funciona por e-mail registrado ou WhatsApp.
- Contas antigas de telefone podem receber o e-mail que JÁ consta em customers, sem trocar sua senha e sem confirmar automaticamente esse e-mail. O código confirma a posse antes da ativação.
- Não substitui um e-mail de autenticação diferente no formulário público. Divergências são revisão pela equipe.
- Clientes novos só entram em customers após OTP verificado. O telefone informado não é confirmação por SMS nem autoriza puxar lotes de outra pessoa.
- Mesmo e-mail não cria outro cliente, graças ao índice normalizado, à trava transacional e ao vínculo único auth_user_id. Telefone já vinculado a outro e-mail não é mesclado.
- A senha só é definida com OTP recente (15 minutos). A função do banco também exige OTP, mesmo se a opção de confirmar e-mail for desligada por engano.
- Links de convite pendentes são invalidados ao concluir ativação por e-mail. Respostas públicas não revelam se uma conta existe.
- Dados do cliente e login de autenticação têm campos distintos. Mudanças posteriores de e-mail feitas pela equipe precisam manter ambos coerentes; este fluxo não implementa troca automática de e-mail de login.

## E-mails nesta entrega

Ativação/cadastro e recuperação usam o mesmo código de acesso. Boas-vindas, pagamento e rastreio são uma próxima etapa; não há campanhas ou notificações adicionais disparadas nesta entrega.

## Validação

`node --test scripts/customer-email-access.test.mjs` executa casos de identidade, conflitos, permissões, OTP expirado e preservação de histórico em banco descartável. Não consulta nem grava produção. Entrega real pelo SMTP ainda precisa do teste após configuração dos templates e aplicação do SQL.

### Revisão final de 31/10/2026

- 10 testes do acesso por e-mail aprovados, incluindo aliases de login das contas antigas e novas.
- 43 testes de regressão de loja, Pix e frete aprovados.
- Build com CUSTOMER_EMAIL_ACCESS_ENABLED=true, TypeScript, ESLint dos arquivos alterados e diff check aprovados.
- Migration e tabela de confirmação reconhecidas por consulta somente leitura no Supabase atual.
- Usuário confirmou que recebeu o código real, definiu a senha e entrou no painel no teste local.
- Telas públicas respondem; ativação sem sessão redireciona para confirmar e-mail e não entrega o formulário de senha.
- Inicialização do SDK de sessão aguarda connection() para evitar temporizadores durante pré-renderização do Next.js.
- O fluxo separa e-mail e código em etapas; Usar outro e-mail reinicia os estados dos formulários.
- Publicação e configuração da variável na Vercel são uma etapa separada. Nenhum deploy desta funcionalidade foi feito nesta revisão.
