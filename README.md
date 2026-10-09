# CRM — Caras das Legends

CRM de leilão diário de figurinhas da Copa 2026 para o grupo WhatsApp **Caras das Legends**.
Gerencia lotes, arremates, estoque, cobranças Pix e entregas.

## Stack

- **Next.js 16.4** (App Router, Turbopack, Cache Components) + **React 19.3** + TypeScript
- **Tailwind CSS v4** + **shadcn/ui** (preset `nova`, base `radix`)
- **Supabase** — Postgres, Auth, Storage e Row Level Security
- **Vercel** para deploy
- Zod v4 · react-hook-form · TanStack Table · Recharts

## Começando

```bash
npm install
cp .env.example .env.local   # e preencha
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

### Variáveis de ambiente

Todas estão documentadas em [`.env.example`](./.env.example). As três essenciais para
subir a aplicação são do Supabase:

| Variável | Onde pegar |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | idem (substitui o antigo `anon key`) |
| `SUPABASE_SECRET_KEY` | idem — **segredo**, só no servidor |

As demais (`MP_*`, `SUPERFRETE_*`, `WHATSAPP_*`) só são exigidas nas fases
em que aquela integração é usada. `GEMINI_API_KEY` existe no `.env.example` mas
**não é usada pelo app**.

### Banco de dados

As migrações criam as tabelas, o RLS e os gatilhos:

- `0001_init.sql` — `customers`, `admin_profiles`, vínculo OTP e helpers de auth
- `0002_lots.sql` — `lots`, `message_log`, bucket `lot-images` e a data de envio padrão
- `0003_stock.sql` — `players`, `stock_items`, `lot_items`, `stock_movements`
  (ledger), RPC `reconcile_lot_items` / `adjust_stock`, catálogo 20×4 e RLS
- `0004_settings.sql` — `app_settings` (incremento, dia do envio e modelos de
  mensagem), endereço do cliente em `customers` e `next_shipping_date`
  configurável
- `0005_charges.sql` — `charges` (cobrança Pix = N lotes de 1 cliente),
  `lots.charge_id` e RLS (equipe escreve, cliente lê as próprias)

```bash
npx supabase link --project-ref <seu-project-ref>
npx supabase db push
```

Sem CLI logado? Cole o conteúdo da migração no **Supabase → SQL Editor → New
query → Run** (na ordem `0001`, `0002`, `0003`, `0004`, `0005`).

Depois, libere o primeiro administrador (RLS impede que qualquer usuário se torne admin):

```sql
select public.add_admin('seu-email@exemplo.com');
```

O e-mail precisa já existir em `auth.users` (faça um login admin falhando uma vez
ou crie o usuário pelo painel do Supabase).

## Login do cliente (OTP por WhatsApp)

O Supabase só envia OTP em WhatsApp pelos provedores **Twilio** e **Twilio Verify**
— e o código já manda `channel: "whatsapp"` em `requestCustomerOtp`, então a
integração é **só configuração**, sem mudança de código.

1. Crie a conta Twilio (plano pago; trial só envia para números verificados) e
   conclua o **WhatsApp Sender self-signup** — exige *business verification* da
   Meta já feita e um número que **não** esteja logado no app WhatsApp.
2. Twilio → **Verify** → crie um *Verification Service*. O Twilio auto-gera os
   templates de autenticação da Meta (Copy Code) nos idiomas suportados, sem
   aprovação manual.
3. Supabase → **Authentication → Providers → Phone** → ative, escolha
   **Twilio Verify** e cole `Account SID`, `Auth Token` e o SID do serviço.
   > O campo se chama **"Twilio Message Service SID"** mas espera o **Verify
   > Service SID (`VA…`)** — é assim que o Auth (GoTrue) usa
   > (`…/v2/Services/{sid}/Verifications`).

Custo por login (Twilio Verify, ago/2026): **US$0,05 de taxa do Verify por
verificação bem-sucedida** (≈ R$0,27) **+ R$0,035** da mensagem de autenticação
da Meta ≈ **R$0,31 por login**. Nada de mensalidade.

> Alternativa mais barata: enviar direto pela **Meta Cloud API** (R$0,035 por
> mensagem, sem taxa de plataforma) — exige Send SMS Hook, Edge Function e
> template AUTHENTICATION aprovado. ~R$14/mês para 400 logins vs ~R$124.

O envio é restrito a telefones já existentes em `customers`
(`customerExistsByPhone`): quem nunca participou de um lote recebe
*"Não encontramos este número"* e não gera conta.

## Estoque e clientes (F2)

- **Catálogo fixo**: `0003_stock.sql` semeia 20 jogadores × 4 cores = **80 SKUs**.
  Não existe parser de foto — o admin escolhe jogador/cor/qtd no formulário do lote.
- **Baixa automática ao salvar o lote** (RPC `reconcile_lot_items`, diff atômico):
  editar o lote recalcula, **cancelar devolve**, **reabrir baixa de novo**.
- **Saldo negativo é liberado** (aviso âmbar no formulário); corrija pela tela de
  Estoque → clique na célula → ajuste com delta (`+10`, `-3`) e nota.
- **Ajustes manuais entram no ledger** (`stock_movements`) com motivo e autor.
- `/admin/clientes` tem busca/paginação server-side, CRUD e ficha com histórico
  de lotes. O cadastro também acontece sozinho ao lançar o lote.
- `GEMINI_API_KEY` **não é usada** — a F2 saiu com catálogo fixo.

## Cobranças Pix — Mercado Pago (F3)

- **Uma cobrança = 1 Pix para N lotes do mesmo cliente.** Soma automática dos
  `arremate_value`; enquanto a cobrança está aberta (pending/in_process), os
  lotes vinculados ficam reservados para ela e não entram em outra cobrança.
- **Mercado Pago Payments API** (`POST /v1/payments` com `payment_method_id:
  pix`): taxa de **0,99%** por transação, recebimento D0. Requer
  `MP_ACCESS_TOKEN`; o Pix expira em **3 dias** (`date_of_expiration`).
  `payer.email` é obrigatório — por isso o cadastro do primeiro login pede
  e-mail (a ficha do cliente completa quem já tem conta).
- **Tela `/admin/cobrancas`** — busca/status/paginação, "Nova cobrança"
  (busca cliente → marca lotes → gera Pix), painel com QR Code, Pix copia-e-cola
  e "Enviar no WhatsApp" (usa o template de pagamento e grava no `message_log`).
  Ações: **Marcar como pago** (manual) e **Cancelar** (libera os lotes).
- **Webhook** `POST|GET /api/webhooks/mercadopago/<MP_WEBHOOK_TOKEN>`: valida o
  token do path em tempo constante, **rebusca o pagamento na API do MP** (a
  notificação só traz o id) e então aplica o status pelo `external_reference`
  conferindo o valor — idempotente; ao aprovar, os lotes viram `paid`. Sem
  `MP_WEBHOOK_TOKEN`, a confirmação fica manual (aviso na própria tela).
- **Painel do cliente** — card "Pagamentos" lista as cobranças, botão "Pagar"
  (abre a página do MP) e **"Gerar Pix dos meus lotes pendentes"**
  (auto-atendimento em 1 clique).
- Migração `0005_charges.sql`; KPIs do dashboard (faturamento do mês e
  cobranças em aberto) saem daqui.

## Configuração e primeiro login (F5)

- **`/admin/configuracao`** (dono edita; equipe só lê):
  - **Parâmetros do leilão** — incremento do lance e dia do envio, salvos em
    `app_settings` e usados no formulário de lote, em `nextShippingDate` e na
    função SQL `next_shipping_date` (gatilho do lote).
  - **Modelos de mensagem WhatsApp** — templates de arremate, pagamento (F3) e
    envio (F4) com chaves `{code}` `{title}` `{value}` `{shipping}` `{link}`
    `{name}` `{tracking}`, chips para inserir e prévia ao vivo. O botão
    "Enviar no WhatsApp" de Lotes usa o template salvo.
  - **Integrações** — status das chaves `MP_*`, `SUPERFRETE_*`, `WHATSAPP_*`
    e do OTP no Supabase (o valor secreto nunca aparece).
  - **Equipe** — lista com e-mails, troca de papel e remoção (dono só; não
    remove a si mesmo nem o último dono). Novo membro: criar o usuário em
    Authentication → Users e rodar `select public.add_admin(...)`.
  - **Exportação LGPD** — CSV (`;`, UTF-8 com BOM) de clientes e lotes via
    `/admin/configuracao/export?tipo=…`, restrito ao dono.
- **Primeiro login do cliente** — `verifyCustomerOtp` manda para
  `/painel/cadastro` quando o endereço está incompleto; o formulário pede nome,
  CEP (auto-preenchimento via ViaCEP), rua, número, bairro, cidade e UF. Depois
  fica em **Meus dados** (header do painel). Sem `0004`, o login cai direto no
  painel.
- **Sem acesso** — `/sem-acesso` é o destino dos guards quando a sessão não
  tem vínculo com a área (evita o loop `/admin → /login → /admin`); mostra o
  caminho alternativo (painel da equipe ou do cliente) e o botão de sair.

## Rotas

| Rota | Acesso | Situação |
| --- | --- | --- |
| `/` | público | landing |
| `/login` | público | login admin (e-mail + senha) |
| `/painel/login` | público | login do cliente (OTP WhatsApp) |
| `/admin/dashboard` | `admin_profiles.role` | painel |
| `/admin/lotes` | admin | **F1–F2** — CRUD, fotos, WhatsApp, baixa de estoque |
| `/admin/estoque` | admin | **F2** — matriz 20×4, ajuste manual e movimentações |
| `/admin/clientes` e `/admin/clientes/[id]` | admin | **F2** — busca, CRUD e ficha com histórico |
| `/admin/configuracao` | admin (dono edita) | **F5** — parâmetros, modelos, equipe, exportação |
| `/admin/cobrancas` | admin | **F3** — cobranças Pix, QR e confirmação |
| `/admin/envios` | admin | em construção (F4) |
| `/api/webhooks/mercadopago/[token]` | token no path | **F3** — confirmação automática |
| `/painel` | cliente autenticado | próprios lotes + card de pagamentos |
| `/painel/cadastro` | cliente autenticado | **F5** — endereço no primeiro login e "Meus dados" |
| `/painel/lotes/[code]` | cliente dono do lote | **F1–F2** — arremate + figurinhas |
| `/sem-acesso` | sessão sem vínculo | destino dos guards (sem loop de redirect) |

Guardas ficam em [`src/lib/dal.ts`](./src/lib/dal.ts) (`requireAdmin`,
`requireCustomer`) e nos layouts de cada área.

## Comandos

```bash
npm run dev        # servidor de desenvolvimento (Turbopack)
npm run build      # build de produção
npm run start      # serve o build
npm run lint       # eslint
npx tsc --noEmit   # typecheck
npx next typegen   # regenera tipos de rota (.next/types/routes.d.ts)
```

> `LayoutProps<"/rota">` usa o caminho **sem** route group: é `"/admin"`,
> não `"/(admin)/admin"`.

## Estrutura

```
src/
  app/
    (marketing)/        landing pública
    (auth)/login/       login admin
    (admin)/admin/      área administrativa (requireAdmin)
    (client)/painel/    área do cliente (requireCustomer)
    actions/            server actions
  components/           ui/ (shadcn) + admin/ + client/ + blocks/
  lib/                  dal, settings, roles, lots, customers, stock, phone
  lib/supabase/         env, client, server, proxy, admin
  proxy.ts              substitui middleware.ts no Next 16
supabase/migrations/    schema + RLS
```

## Notas do Next 16

- `middleware.ts` não existe mais — o guard é [`src/proxy.ts`](./src/proxy.ts),
  exportando `proxy` (com `matcher`).
- **Cache Components** está ligado por padrão. Rotas autenticadas leem `cookies()`
  e por isso declaram `export const instant = false` para bloquear o prerender.
  Adoção de `use cache: private` + `<Suspense>` fica para a fase de performance.
- A documentação local está em `node_modules/next/dist/docs/`.
