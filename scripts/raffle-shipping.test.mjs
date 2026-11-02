import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { loadCommerceDb } from './fixtures/commerce-db.mjs';

test('Frete dos prêmios: empresa paga somente pacote exclusivo de rifa',async t=>{
 const db=new PGlite(),actor=crypto.randomUUID();
 const v=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
 const owner=()=>db.exec('reset role');
 const service=async()=>{await owner();await db.exec('set role service_role');};
 const create=async()=>{
  await owner();const customer=await v("insert into customers(id,name,email) values(gen_random_uuid(),'Fixture','test@example.invalid') returning id");
  const c=await v("insert into raffle_campaigns(title,description,total_numbers,unit_price,selection_mode,draw_method,draw_rules,created_by,max_quantity) values('Fixture','Regulamento de teste',10,10,'both','external','Sorteio externo',$1,10) returning id",[actor]);
  const o=await v("insert into raffle_orders(campaign_id,customer_id,request_key,amount,numbers,status) values($1,$2,gen_random_uuid(),10,array[0],'paid') returning id",[c,customer]);
  const prize=await v("insert into raffle_prizes(campaign_id,title,kind,number) values($1,'Prêmio','instant',0) returning id",[c]);
  const issue=await v("insert into logistics_pending(customer_id,title,quantity,reason,shipping_date,created_by,source_kind) values($1,'Prêmio',1,'Rifa',current_date,$2,'raffle') returning id",[customer,actor]);
  await db.query('insert into raffle_awards(prize_id,campaign_id,order_id,customer_id,number,logistics_id) values($1,$2,$3,$4,0,$5)',[prize,c,o,customer,issue]);
  await db.query("select set_config('test.admin','true',false)");await db.query('select box_raffle_award($1,50)',[issue]);
  const shipment=await v('insert into shipments(customer_id,batch_date,insurance_value) values($1,current_date,50) returning id',[customer]);
  return {customer,o,issue,shipment,snapshot:{lots:[],store:[],logistics:[{id:issue,value:50}]}};
 };
 try{
  await loadCommerceDb(db);await db.query('insert into auth.users values($1)',[actor]);await db.query("insert into admin_profiles values($1,'owner')",[actor]);await db.query("select set_config('test.actor',$1,false)",[actor]);
  await t.test('prêmio avulso vincula, declara e permite etiqueta sem criar cobrança nem consumir crédito',async()=>{
   const x=await create();await service();await db.query('select bind_shipment_contents($1,$2)',[x.shipment,JSON.stringify(x.snapshot)]);await db.query('select assert_shipment_freight($1)',[x.shipment]);
   await owner();assert.equal(await v('select freight_payer from shipments where id=$1',[x.shipment]),'company');
   assert.equal(Number(await v('select count(*) from charges where customer_id=$1',[x.customer])),0);assert.equal(Number(await v('select count(*) from shipment_freight_usage where shipment_id=$1',[x.shipment])),0);
   await db.query("update shipments set status='cancelled' where id=$1",[x.shipment]);assert.equal(await v('select shipment_id from logistics_pending where id=$1',[x.issue]),null);
   const next=await v('insert into shipments(customer_id,batch_date,insurance_value) values($1,current_date,50) returning id',[x.customer]);
   await service();await db.query('select bind_shipment_contents($1,$2)',[next,JSON.stringify(x.snapshot)]);await db.query('select assert_shipment_freight($1)',[next]);
   await owner();await db.query("update raffle_orders set status='review' where id=$1",[x.o]);await service();await assert.rejects(db.query('select assert_shipment_freight($1)',[next]),/conteúdo e o pagamento/);
  });
  await t.test('produto da loja junto do prêmio continua exigindo frete pago; forjar isenção não contorna',async()=>{
   const x=await create();const product=await v("insert into loyalty_rewards(name,cash_price,stock,internal_cost,active) values('Produto',80,1,1,true) returning id");
   const order=await v("insert into store_orders(customer_id,request_key,external_reference,cash_total,coins_total,payment_status,fulfillment_status) values($1,gen_random_uuid(),'shop_'||gen_random_uuid(),80,0,'paid','processing') returning id",[x.customer]);
   await db.query("insert into store_order_items(order_id,reward_id,name,quantity,price_mode,unit_cash,unit_coins,reserved_stock) values($1,$2,'Produto',1,'cash',80,0,true)",[order,product]);await db.query('select box_store_order($1)',[order]);
   const expected={...x.snapshot,store:[{id:order,value:80}]};await db.query('update shipments set insurance_value=130 where id=$1',[x.shipment]);await service();
   await assert.rejects(db.query('select bind_shipment_contents($1,$2)',[x.shipment,JSON.stringify(expected)]),/frete.*não foi pago/);
   await owner();await db.query("insert into charges(customer_id,status,freight_amount,freight_period) values($1,'approved',20,current_date)",[x.customer]);await service();await db.query('select bind_shipment_contents($1,$2)',[x.shipment,JSON.stringify(expected)]);await db.query('select assert_shipment_freight($1)',[x.shipment]);
   await owner();assert.equal(await v('select freight_payer from shipments where id=$1',[x.shipment]),'customer');await db.query("update shipments set freight_payer='company' where id=$1",[x.shipment]);await service();await assert.rejects(db.query('select assert_shipment_freight($1)',[x.shipment]),/conteúdo e o pagamento/);
  });
  await t.test('omitir lote pago do pacote não converte envio em prêmio isento',async()=>{
   const x=await create();await db.query("insert into lots(id,customer_id,status,shipping_date) values(gen_random_uuid(),$1,'paid',current_date)",[x.customer]);
   await service();assert.equal(await v('select raffle_only_package($1,current_date,$2)',[x.customer,x.shipment]),false);
   await assert.rejects(db.query('select bind_shipment_contents($1,$2)',[x.shipment,JSON.stringify(x.snapshot)]),/Nenhum lote, produto ou prêmio elegível/);
  });
  await t.test('frete já pago do cliente fica disponível e cliente não chama helpers privados',async()=>{
   const x=await create();await db.query("insert into charges(customer_id,status,freight_amount,freight_period) values($1,'approved',20,current_date)",[x.customer]);
   await db.exec('set role authenticated');await assert.rejects(db.query('select claim_shipment_freight($1)',[x.shipment]),/permission denied/);await assert.rejects(db.query('select raffle_only_package($1,current_date,$2)',[x.customer,x.shipment]),/permission denied/);
   await service();await db.query('select bind_shipment_contents($1,$2)',[x.shipment,JSON.stringify(x.snapshot)]);
   assert.equal(Number(await v('select count(*) from available_shipment_freight($1)',[x.customer])),1);
  });
 }finally{await db.close();}
});
