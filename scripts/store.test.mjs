import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../src/lib/store.ts',import.meta.url),'utf8');
const code = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
  .replace('from "zod"',`from ${JSON.stringify(pathToFileURL(require.resolve('zod')).href)}`);
const {productPrices,cartTotals,cartCheckoutSchema,safePixTicketUrl} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const customerA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const customerB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const productId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

test('preços independentes e soma exata de quantidades em centavos', () => {
  assert.deepEqual(productPrices({points_cost:100,cash_price:29.9,mixed_cash_price:9.9,mixed_points_cost:40}),[
    {mode:'coins',cash:0,coins:100},{mode:'cash',cash:29.9,coins:0},{mode:'mixed',cash:9.9,coins:40},
  ]);
  assert.deepEqual(productPrices({points_cost:null,cash_price:null,mixed_cash_price:10,mixed_points_cost:null}),[]);
  assert.deepEqual(cartTotals([{quantity:3,expected_cash:0.1,expected_coins:2.5},{quantity:2,expected_cash:0.2,expected_coins:0}]),{cash:70,coins:750,quantity:5});
  assert.equal(cartCheckoutSchema.safeParse({requestKey:crypto.randomUUID(),items:[{reward_id:productId,quantity:-1,mode:'cash',expected_cash:10,expected_coins:0}]}).success,false);
  assert.equal(safePixTicketUrl('javascript:alert(1)'),null);
  assert.equal(safePixTicketUrl('https://mercadopago.com.br.evil.invalid/pay'),null);
  assert.equal(safePixTicketUrl('https://www.mercadopago.com.br/pay'),'https://www.mercadopago.com.br/pay');
});

test('Mercado Pago: contrato de criação idempotente e cancelamento oficial, com HTTP simulado', async () => {
  const mpSource = (await readFile(new URL('../src/lib/mercadopago.ts',import.meta.url),'utf8'))
    .replace('import "server-only";','').replace('import { siteUrl } from "@/lib/lots";','const siteUrl = () => "https://example.invalid";');
  const mpCode = ts.transpileModule(mpSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  const {createPixOrder,cancelPixOrder,targetChargeStatus} = await import(`data:text/javascript;base64,${Buffer.from(mpCode).toString('base64')}`);
  const originalFetch = globalThis.fetch;
  const previousToken = process.env.MP_ACCESS_TOKEN;
  process.env.MP_ACCESS_TOKEN = 'fake-test-token-not-a-credential';
  const calls = [];
  try {
    globalThis.fetch = async (url,options) => {
      calls.push({url,options});
      return Response.json(url.endsWith('/cancel') ? {status:'canceled'} : {id:'ORD_test_cart',status:'action_required',total_amount:'29.90',transactions:{payments:[{payment_method:{qr_code:'fake-qr-code'}}]}});
    };
    const payment=await createPixOrder({amount:29.9,description:'Teste',externalReference:'shop_request_123',payerEmail:'teste@example.invalid'});
    assert.equal(payment.amount,29.9);
    assert.equal(calls[0].options.headers['X-Idempotency-Key'],'shop_request_123');
    assert.equal(JSON.parse(calls[0].options.body).total_amount,'29.90');
    assert.equal(await cancelPixOrder('ORD_test_cart'),true);
    assert.equal(calls[1].url,'https://api.mercadopago.com/v1/orders/ORD_test_cart/cancel');
    assert.equal(calls[1].options.method,'POST');
    assert.ok(calls[1].options.headers['X-Idempotency-Key']);
    globalThis.fetch=async () => new Response('{}',{status:400});
    assert.equal(await cancelPixOrder('ORD_test_cart'),false);
    assert.equal(targetChargeStatus('processed','accredited'),'approved');
    assert.equal(targetChargeStatus('action_required','waiting_payment'),null);
  } finally {
    globalThis.fetch=originalFetch;
    if (previousToken===undefined) delete process.env.MP_ACCESS_TOKEN; else process.env.MP_ACCESS_TOKEN=previousToken;
  }
});

test('PostgreSQL: reservas, idempotência, estornos, permissões e isolamento', async (t) => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(new URL('./fixtures/store-baseline.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/0024_store_cart_and_pix.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/0025_store_catalog_admin.sql',import.meta.url),'utf8'));
    await db.query('insert into customers(id,email) values($1,$3),($2,$3)',[customerA,customerB,'teste@example.invalid']);
    await db.query("insert into loyalty_ledger(customer_id,points,kind,note) values($1,1000,'adjustment','fixture'),($2,1000,'adjustment','fixture')",[customerA,customerB]);
    await db.query("insert into loyalty_rewards(id,name,points_cost,cash_price,mixed_cash_price,mixed_points_cost,internal_cost,stock,active) values($1,'Produto',100,29.90,9.90,40,5,10,true)",[productId]);
    const asCustomer = async (id=customerA) => { await db.exec(`set role authenticated; select set_config('test.customer','${id}',false); select set_config('test.admin','false',false)`); };
    const asOwner = () => db.exec('reset role');
    const checkout = async (items,key=crypto.randomUUID()) => (await db.query('select checkout_store_cart($1,$2::jsonb) as id',[key,JSON.stringify(items)])).rows[0].id;
    const line = (mode,quantity=1) => ({reward_id:productId,quantity,mode,expected_cash:mode==='cash'?29.9:mode==='mixed'?9.9:0,expected_coins:mode==='coins'?100:mode==='mixed'?40:0});
    const scalar = async (sql,args=[]) => Object.values((await db.query(sql,args)).rows[0])[0];
    const settle = async (id,status,amount=19.8,payment='ORD_test_1') => {
      await asOwner(); await db.exec('set role service_role');
      try { await db.query('select settle_store_payment($1,$2,$3,$4,null)',['shop_'+id,payment,amount,status]); }
      finally { await asOwner(); }
    };
    let order;
    await t.test('carrinho misto reserva estoque e moedas uma única vez',async () => {
      await asCustomer(); const key=crypto.randomUUID();
      order=await checkout([line('mixed',2)],key);
      assert.equal(await checkout([line('mixed',2)],key),order);
      await asOwner();
      assert.equal(await scalar('select stock from loyalty_rewards where id=$1',[productId]),8);
      assert.equal(await scalar('select sum(points)::text from loyalty_ledger where customer_id=$1',[customerA]),'920.00');
      assert.equal(await scalar('select cash_total::text from store_orders where id=$1',[order]),'19.80');
      await asCustomer(); await assert.rejects(checkout([line('cash')]),/já tem um pedido/);
    });
    await t.test('cliente não consegue confirmar seu Pix nem ler custos ou pedidos de outro',async () => {
      await asCustomer(customerB);
      assert.equal(await scalar('select count(*)::integer from store_orders'),0);
      assert.equal(await scalar('select count(*)::integer from store_order_items'),0);
      await assert.rejects(db.query('select internal_cost from loyalty_rewards'),/permission denied/);
      await assert.rejects(db.query("select settle_store_payment($1,'ORD_test_1',19.8,'paid',null)",['shop_'+order]),/permission denied/);
      await assert.rejects(db.query("update store_orders set payment_status='paid'"),/permission denied/);
    });
    await t.test('valor ou identidade divergente não confirma; replay não debita novamente',async () => {
      await assert.rejects(settle(order,'paid',1),/divergente/);
      await settle(order,'paid'); await settle(order,'paid');
      await assert.rejects(settle(order,'paid',19.8,'ORD_outro'),/divergente/);
      assert.equal(await scalar("select count(*)::integer from loyalty_ledger where store_order_id=$1 and kind='spent'",[order]),1);
      assert.equal(await scalar('select payment_status from store_orders where id=$1',[order]),'paid');
    });
    await t.test('devolução integral repetida devolve moedas e estoque só uma vez',async () => {
      await settle(order,'refunded'); await settle(order,'refunded');
      assert.equal(await scalar('select stock from loyalty_rewards where id=$1',[productId]),10);
      assert.equal(await scalar('select sum(points)::text from loyalty_ledger where customer_id=$1',[customerA]),'1000.00');
    });
    await t.test('saldo, estoque, preço alterado e modalidade desativada fazem rollback completo',async () => {
      await asCustomer();
      await assert.rejects(checkout([line('coins',11)]),/Estoque insuficiente/);
      await assert.rejects(checkout([{...line('cash'),expected_cash:1}]),/preço.*mudou/);
      await asOwner(); await db.query("update loyalty_rewards set mixed_cash_price=null,mixed_points_cost=null,points_cost=2000 where id=$1",[productId]);
      await asCustomer();
      await assert.rejects(checkout([line('mixed')]),/Modalidade/);
      await assert.rejects(checkout([{...line('coins'),expected_coins:2000}]),/Saldo.*insuficiente/);
      await asOwner();
      assert.equal(await scalar('select stock from loyalty_rewards where id=$1',[productId]),10);
      assert.equal(await scalar('select count(*)::integer from store_orders'),1);
      await db.query('update loyalty_rewards set points_cost=100,mixed_cash_price=9.90,mixed_points_cost=40 where id=$1',[productId]);
    });
    await t.test('cancelamento antes do pagamento libera reservas, e pagamento tardio exige revisão',async () => {
      await asCustomer(); const id=await checkout([line('mixed')]);
      await settle(id,'cancelled',9.9,'ORD_cancel'); await settle(id,'cancelled',9.9,'ORD_cancel');
      await settle(id,'paid',9.9,'ORD_cancel');
      assert.equal(await scalar('select payment_status from store_orders where id=$1',[id]),'payment_review');
      await settle(id,'refunded',9.9,'ORD_cancel');
      assert.equal(await scalar('select sum(points)::text from loyalty_ledger where customer_id=$1',[customerA]),'1000.00');
      assert.equal(await scalar('select stock from loyalty_rewards where id=$1',[productId]),10);
    });
    await t.test('compra em Caracoins é paga imediatamente; ADM cancela sem duplicar devolução',async () => {
      await asCustomer(); const id=await checkout([line('coins',2)]);
      assert.equal(await scalar('select payment_status from store_orders where id=$1',[id]),'paid');
      await assert.rejects(db.query("select handle_store_order($1,'fulfilled',null)",[id]),/Acesso negado/);
      await db.exec("select set_config('test.admin','true',false)");
      await db.query("select handle_store_order($1,'cancelled','Cancelamento de teste')",[id]);
      await assert.rejects(db.query("select handle_store_order($1,'cancelled',null)",[id]),/Somente pedidos/);
      await asOwner();
      assert.equal(await scalar('select sum(points)::text from loyalty_ledger where customer_id=$1',[customerA]),'1000.00');
    });
    await t.test('pedido entregue e reembolsado devolve moedas sem recolocar item entregue no estoque',async () => {
      await asCustomer(); const id=await checkout([line('mixed')]);
      await settle(id,'paid',9.9,'ORD_delivered');
      await asCustomer(); await db.exec("select set_config('test.admin','true',false)");
      await db.query("select handle_store_order($1,'fulfilled',null)",[id]);
      await settle(id,'refunded',9.9,'ORD_delivered');
      assert.equal(await scalar('select stock from loyalty_rewards where id=$1',[productId]),9);
      assert.equal(await scalar('select sum(points)::text from loyalty_ledger where customer_id=$1',[customerA]),'1000.00');
    });
    await t.test('produtos diferentes e quantidades no mesmo carrinho somam as duas moedas',async () => {
      const second='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      await asOwner();
      await db.query("insert into loyalty_rewards(id,name,points_cost,mixed_cash_price,mixed_points_cost,internal_cost,stock,active) values($1,'Segundo produto',50,5,20,0,5,true)",[second]);
      await asCustomer();
      const id=await checkout([line('cash',2),{reward_id:second,quantity:3,mode:'mixed',expected_cash:5,expected_coins:20}]);
      assert.equal(await scalar('select cash_total::text from store_orders where id=$1',[id]),'74.80');
      assert.equal(await scalar('select coins_total::text from store_orders where id=$1',[id]),'60.00');
      await settle(id,'expired',74.8,'ORD_multi');
      assert.equal(await scalar('select stock from loyalty_rewards where id=$1',[second]),5);
      assert.equal(await scalar("select count(*)::integer from loyalty_ledger where kind='earned'"),0);
    });
    await t.test('dois clientes disputando a última unidade não geram estoque negativo',async () => {
      await asOwner(); await db.query('update loyalty_rewards set stock=1 where id=$1',[productId]);
      await asCustomer(); const id=await checkout([line('cash')]);
      await db.exec("select set_config('test.admin','true',false)");
      await assert.rejects(db.query("select handle_store_order($1,'fulfilled',null)",[id]),/Somente pedidos pagos/);
      await asCustomer(customerB); await assert.rejects(checkout([line('cash')]),/Estoque insuficiente/);
      await asOwner(); assert.equal(await scalar('select stock from loyalty_rewards where id=$1',[productId]),0);
      await settle(id,'cancelled',29.9,'ORD_last_unit');
      assert.equal(await scalar('select stock from loyalty_rewards where id=$1',[productId]),1);
    });
    await t.test('devolução parcial bloqueia separação e não devolve moedas até estorno integral',async () => {
      await asCustomer(); const id=await checkout([line('mixed')]);
      await settle(id,'paid',9.9,'ORD_partial'); await settle(id,'partially_refunded',9.9,'ORD_partial');
      await asCustomer(); await db.exec("select set_config('test.admin','true',false)");
      await assert.rejects(db.query("select handle_store_order($1,'fulfilled',null)",[id]),/Somente pedidos pagos/);
      await asOwner(); assert.equal(await scalar('select sum(points)::text from loyalty_ledger where customer_id=$1',[customerA]),'960.00');
      await settle(id,'refunded',9.9,'ORD_partial');
      assert.equal(await scalar('select sum(points)::text from loyalty_ledger where customer_id=$1',[customerA]),'1000.00');
    });
    await t.test('saldo negativo por estorno de lote não impede compra somente em reais',async () => {
      await asOwner();
      await db.query("insert into loyalty_ledger(customer_id,points,kind,note) values($1,-1100,'adjustment','Estorno de teste')",[customerA]);
      await asCustomer(); const id=await checkout([line('cash')]);
      await settle(id,'expired',29.9,'ORD_negative_balance');
      assert.equal(await scalar('select sum(points)::text from loyalty_ledger where customer_id=$1',[customerA]),'-100.00');
    });
    await t.test('carrinhos inválidos e acesso anônimo são recusados pelo próprio banco',async () => {
      await asCustomer(customerB);
      await assert.rejects(checkout([]),/carrinho deve/);
      await assert.rejects(checkout([line('cash'),line('cash')]),/duplicado/);
      await asOwner(); await db.exec('set role anon');
      await assert.rejects(checkout([line('cash')]),/permission denied/);
      await assert.rejects(db.query('select * from store_orders'),/permission denied/);
      await asOwner();
    });
    await t.test('reserva muda a versão do catálogo e evita sobrescrever estoque com formulário antigo',async () => {
      const before=await scalar('select updated_at::text from loyalty_rewards where id=$1',[productId]);
      await asCustomer(customerB); const id=await checkout([line('cash')]);
      await asOwner();
      const stale=await db.query('update loyalty_rewards set stock=99 where id=$1 and updated_at=$2 returning id',[productId,before]);
      assert.equal(stale.rows.length,0);
      assert.equal(await scalar('select stock from loyalty_rewards where id=$1',[productId]),0);
      await settle(id,'expired',29.9,'ORD_stale_admin');
    });
  } finally { await db.close(); }
});
