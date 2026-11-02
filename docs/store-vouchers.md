# Loja: produtos e vouchers

Implementação local, sem liberação de compras em produção.

## Funcionamento

- Cada produto tem preço em reais ou Caracoins. Carrinhos de moedas diferentes são separados.
- Vouchers são resgatados com Caracoins e guardam uma cópia das regras vigentes no resgate.
- Uma compra em reais aceita um voucher. O desconto considera somente produtos elegíveis, nunca o frete.
- O voucher fica reservado enquanto o Pix está pendente. Cancelamento antes do pagamento libera a reserva, mantendo a validade original.
- Pagamento confirmado consome o voucher. Estorno após o pagamento exige revisão administrativa; não devolve automaticamente o voucher nem as moedas.
- Validade vencida não devolve Caracoins automaticamente.
- Se o desconto cobrir todo o valor dos produtos, a compra é confirmada sem gerar Pix de valor zero.
- Pedidos antigos mantêm os valores e modalidades originais.

## Administração

Em Loja → Vouchers, cadastre custo em Caracoins, desconto em reais, compra mínima elegível, validade, produtos e limites de resgate. Custo e desconto podem ficar em branco no rascunho; são obrigatórios para ativar o voucher. Alterações não modificam vouchers já emitidos.

## Banco e liberação

Revisar e aplicar `supabase/migrations/0037_store_vouchers.sql` depois das migrations anteriores do projeto. Ela cria as tabelas, políticas de acesso e funções de checkout e resgate.

A migration mantém compras desativadas em `store_commerce_settings`. Após a migration 0039, o aplicativo lê essa configuração no banco; somente o dono pode alterá-la em Loja → Configurações, com motivo registrado. A liberação deve ocorrer apenas após concluir e validar a logística de compras sem lotes de leilão. Produtos antigos com preços em duas moedas precisam ser revisados no ADM antes da liberação.

## Validação

Execute `npm run test:store` e `npm run build`. Os testes usam banco local em memória, sem pagamentos reais ou alterações no Supabase de produção.
