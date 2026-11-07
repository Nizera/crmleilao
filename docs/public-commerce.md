# Loja e rifas públicas

## Endereços

- `/loja`: produtos, busca, filtros, ordenação e seleção de vários itens.
- `/rifas`: campanhas publicadas, busca e campanhas encerradas.
- `/rifas/<id>`: fotos, regulamento, prêmios, situação das cotas e seleção manual/automática.

Links antigos de catálogo em `/painel/loja` e `/painel/rifas` redirecionam visitantes para as páginas públicas. Pedidos, extratos, carteira de vouchers, números comprados e prêmios pessoais continuam exigindo sessão de cliente. Quem já é cliente conectado segue para o painel equivalente.

## Ativação

Executar `supabase/migrations/0066_public_commerce.sql` após as migrations anteriores, incluindo 0064. Esta migration adiciona somente funções de leitura pública e concede execução delas a anon/authenticated. Não abre tabelas privadas nem modifica funções de checkout, reserva, pagamento ou apuração. Não modifica as chaves de habilitação de vendas.

O usuário confirmou a execução da migration 0066. A consulta anônima real retornou catálogo e campanhas sem revelar custos internos; os pedidos continuaram protegidos. O deploy foi autorizado em 07/11/2026.

## Login e retomada

O carrinho público e a seleção de cotas ficam no sessionStorage da mesma aba. Só contêm IDs, quantidades e preços de referência, nunca dados pessoais nem credenciais. Ao continuar a compra, o visitante entra no login com opção de criar conta ou recuperar acesso por e-mail. O destino é preservado também na verificação do código, definição de senha e preenchimento de endereço, quando necessário.

O servidor aceita apenas destinos internos permitidos da loja/rifa; URLs externas e outros destinos são descartados. O carrinho público é incorporado uma única vez ao carrinho da conta, sem gerar pagamento. Quantidades, disponibilidade e preços são conferidos novamente. O cliente ainda precisa confirmar a compra. A seleção de cotas é retomada sem criar reserva automática; cotas ocupadas na página atual são descartadas e todas são revalidadas no banco ao confirmar.

Nenhum estoque ou cota fica reservado só por navegar publicamente ou iniciar login. Os dez minutos da rifa começam ao confirmar uma reserva autenticada. Se o visitante trocar de navegador/aba, bloquear armazenamento ou fechar a sessão da aba, a seleção poderá não ser preservada.

## Privacidade

As funções públicas devolvem projeções de catálogo/campanha, nunca compradores, IDs de clientes, pedidos, saldo ou custos internos. Rascunhos e campanhas arquivadas não são retornados. Os números de cotas premiadas ocultas continuam nulos. A leitura das fotos do banner usa projeção específica no servidor e filtra banner ativo.

## Validação

- 19 testes de login/cadastro, proxy, retorno seguro, leitura pública e interface de pagamento passaram.
- 37 testes de regressão da loja, rifas e apresentação passaram.
- Após organizar a retomada com estado agrupado/armazenamento externo, os oito testes de proxy, leitura pública e interface foram repetidos e passaram.
- Compilação de produção passou com `/loja`, `/rifas` e `/rifas/[id]` registradas.
- Lint dos arquivos alterados foi executado; problemas iniciais de estado síncrono em efeitos foram corrigidos.
- Nenhuma compra, reserva ou pagamento de produção foi criado, cancelado ou modificado nestes testes.
- A navegação autenticada real após um novo OTP e a revisão visual com o catálogo real dependem da aplicação da migration e do teste manual local; não foram declaradas como realizadas.
