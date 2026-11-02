# Piloto da loja no localhost

Aplicar a migration 0040 após a 0039. Não abre as compras globalmente.

O `.env.local` contém `STORE_LOCAL_TEST_CUSTOMER_ID` com o identificador da conta autorizada. Esse valor não deve ser configurado na Vercel. O piloto só funciona com `NODE_ENV=development`, fora da Vercel, host de loopback e sessão autenticada da conta indicada. A configuração do ADM continua mostrando o estado global.

A RPC de piloto só pode ser chamada pelo servidor com a credencial privilegiada. Executa compra/resgate em uma transação e restaura o estado fechado antes de confirmar. Outros clientes não observam um estado aberto; exceções desfazem a operação inteira. O teste automatizado cobre essas condições no banco descartável.

Os produtos, pedidos, estoque e Caracoins são do Supabase compartilhado. Não é um ambiente de dados fictícios. Pix gerado com credenciais de produção também é real. Não efetuar pagamento real sem intenção de concluir o piloto.

Para encerrar o piloto, remover `STORE_LOCAL_TEST_CUSTOMER_ID` do `.env.local` e reiniciar o localhost. O acesso público continua dependendo da configuração global do dono.
