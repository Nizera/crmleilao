import { test } from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {loadCommerceDb,migration} from './fixtures/commerce-db.mjs';

test('cancelamento e pagamentos cruzados: recursos, permissões, corrida e frete único',async t=>{
 const db=new PGlite();const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
 const owner=()=>db.exec('reset role');
 const customer=async(id)=>{await owner();await db.exec('set role authenticated');await db.query("select set_config('test.customer',$1,false)",[id]);await db.exec("select set_config('test.admin','false',false)");};
 const product=crypto.randomUUID();let who;
 const fresh=async()=>{await owner();const id=crypto.randomUUID();await db.query("insert into customers(id,name,email,phone_e164,cpf_cnpj,address_cep,address_street,address_number,address_district,address_city,address_state) values($1,'Fixture','fixture@example.invalid','+5500000000000','11111111111','18110000','Rua','1','Centro','Cidade','SP')",[id]);await db.query("insert into loyalty_ledger(customer_id,points,kind,note) values($1,20000,'adjustment','fixture')",[id]);await customer(id);return id;};
 const checkout=()=>scalar('select checkout_store_cart_cancellable($1,$2::jsonb,null)',[crypto.randomUUID(),JSON.stringify([{reward_id:product,quantity:1,mode:'cash',expected_cash:80,expected_coins:0,expected_freight_amount:20}])]);
 const request=async(id,customerId=who)=>{await owner();return scalar('select request_store_order_cancellation($1,$2)',[id,customerId]);};
 const settle=async(id,status)=>{await owner();return db.query("select settle_store_payment(external_reference,'ORD_'||id::text,cash_total,$2,null) from store_orders where id=$1",[id,status]);};
 try{
  await loadCommerceDb(db);await db.exec(await migration('0061_store_cancellation_and_auction_payments.sql'));
  await db.exec("update store_commerce_settings set purchases_enabled=true");
  await db.query("insert into loyalty_rewards(id,name,internal_cost,cash_price,stock,active,delivery_kind) values($1,'Produto',1,80,100,true,'physical')",[product]);
  await db.exec('create trigger lot_freight_guard before update of charge_id on lots for each row execute function require_lot_period_freight()');
  await t.test('cancelamento antes da criação libera estoque exatamente uma vez, não cria Pix e isola clientes',async()=>{
   who=await fresh();const id=await checkout();await owner();assert.equal(Number(await scalar('select stock from loyalty_rewards where id=$1',[product])),99);
   await assert.rejects(request(id,crypto.randomUUID()),/não encontrado/);
   await customer(who);await assert.rejects(db.query('select request_store_order_cancellation($1,$2)',[id,who]),/permission denied/);await assert.rejects(db.query('select claim_store_pix_creation($1)',[id]),/permission denied/);
   assert.equal(await request(id),'cancelled');assert.equal(await request(id),'cancelled');
   assert.equal(Number(await scalar('select stock from loyalty_rewards where id=$1',[product])),100);
   assert.equal(await scalar('select claim_store_pix_creation($1)',[id]),false);
   assert.equal(await scalar('select mp_order_id from store_orders where id=$1',[id]),null);
  });
  await t.test('tentativa remota incerta mantém reserva até confirmação; pagamento tardio entra em revisão',async()=>{
   who=await fresh();const id=await checkout();await owner();assert.equal(await scalar('select claim_store_pix_creation($1)',[id]),true);
   assert.equal(await request(id),'creating');assert.equal(Number(await scalar('select stock from loyalty_rewards where id=$1',[product])),99);
   assert.ok(await scalar('select cancellation_requested_at from store_orders where id=$1',[id]));
   assert.equal(await scalar('select claim_store_pix_creation($1)',[id]),true);
   await settle(id,'cancelled');await settle(id,'cancelled');assert.equal(Number(await scalar('select stock from loyalty_rewards where id=$1',[product])),100);
   await settle(id,'paid');assert.equal(await scalar('select payment_status from store_orders where id=$1',[id]),'payment_review');assert.equal(await request(id),'payment_review');
  });
  await t.test('Pix da loja não bloqueia pagamento dos lotes e não duplica frete; cancelamento devolve frete devido',async()=>{
   who=await fresh();const id=await checkout();await owner();const lot=crypto.randomUUID(),charge=crypto.randomUUID();
   await db.query("insert into lots(id,customer_id,code,title,status,auction_date,created_at) values($1,$2,'L-FIX','Lote','pending_payment',current_date,now())",[lot,who]);
   await db.query("insert into charges(id,customer_id,status,amount) values($1,$2,'pending',30)",[charge,who]);
   assert.equal(Number(await scalar('select reserve_charge_freights($1,$2::uuid[])',[charge,[lot]])),0);
   await db.query('update lots set charge_id=$1 where id=$2',[charge,lot]);
   await db.query("update lots set status='paid' where id=$1",[lot]);
   await customer(who);assert.equal((await scalar('select get_customer_freight_summary()')).storeOrderId,id);
   await request(id);await owner();assert.equal(Number(await scalar('select sum(freight_amount) from get_due_freight_periods($1)',[who])),20);
   const shipping=crypto.randomUUID();await db.query('insert into shipments(id,customer_id,batch_date) values($1,$2,current_date)',[shipping,who]);await assert.rejects(db.query('select claim_shipment_freight($1)',[shipping]),/não foi pago/);
   const freightCharge=crypto.randomUUID();await db.query("insert into charges(id,customer_id,status,amount,freight_amount,freight_period) values($1,$2,'approved',20,20,current_date)",[freightCharge,who]);
   await customer(who);assert.equal((await scalar('select get_store_freight_quote()')).amount,0);
  });
  await t.test('cancelar antes do Pix devolve voucher e Caracoins uma única vez',async()=>{
   who=await fresh();await owner();const template=crypto.randomUUID();
   await db.query("insert into store_voucher_templates(id,name,coins_cost,discount_cash,min_purchase,active,max_per_customer) values($1,'Voucher fixture',1500,10,10,true,20)",[template]);
   await customer(who);const voucher=await scalar('select redeem_store_voucher($1,$2)',[template,crypto.randomUUID()]);
   const id=await scalar('select checkout_store_cart_cancellable($1,$2::jsonb,$3)',[crypto.randomUUID(),JSON.stringify([{reward_id:product,quantity:1,mode:'cash',expected_cash:80,expected_coins:0,expected_freight_amount:20}]),voucher]);
   await request(id);await owner();assert.equal(await scalar('select status from customer_store_vouchers where id=$1',[voucher]),'available');assert.equal(await scalar('select order_id from customer_store_vouchers where id=$1',[voucher]),null);
   const coinProduct=crypto.randomUUID();await db.query("insert into loyalty_rewards(id,name,internal_cost,points_cost,stock,active,delivery_kind) values($1,'Coins fixture',1,100,10,true,'physical')",[coinProduct]);
   await customer(who);const coinOrder=await scalar('select checkout_store_cart_cancellable($1,$2::jsonb,null)',[crypto.randomUUID(),JSON.stringify([{reward_id:coinProduct,quantity:1,mode:'coins',expected_cash:0,expected_coins:100,expected_freight_amount:20}])]);
   await owner();const reserved=Number(await scalar('select sum(points) from loyalty_ledger where customer_id=$1',[who]));await request(coinOrder);await request(coinOrder);assert.equal(Number(await scalar('select sum(points) from loyalty_ledger where customer_id=$1',[who])),reserved+100);assert.equal(Number(await scalar('select stock from loyalty_rewards where id=$1',[coinProduct])),10);
  });
  await t.test('checkout da versão anterior sem ID nunca é liberado por engano durante o rollout',async()=>{
   who=await fresh();const id=await scalar('select checkout_store_cart_v2($1,$2::jsonb,null)',[crypto.randomUUID(),JSON.stringify([{reward_id:product,quantity:1,mode:'cash',expected_cash:80,expected_coins:0,expected_freight_amount:20}])]);
   await owner();assert.equal(await scalar('select pix_creation_managed from store_orders where id=$1',[id]),false);assert.equal(await request(id),'creating');assert.equal(await scalar('select resources_released_at from store_orders where id=$1',[id]),null);assert.equal(await scalar('select claim_store_pix_creation($1)',[id]),true);await settle(id,'cancelled');
  });
  await t.test('pedido pago não pode ser cancelado como Pix e a migration é reaplicável',async()=>{
   who=await fresh();const id=await checkout();await settle(id,'paid');assert.equal(await request(id),'paid');assert.equal(await scalar('select resources_released_at from store_orders where id=$1',[id]),null);
   await db.exec(await migration('0061_store_cancellation_and_auction_payments.sql'));
  });
 }finally{await db.close();}
});
