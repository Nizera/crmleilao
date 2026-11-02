import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {loadCommerceDb,migration} from './fixtures/commerce-db.mjs';
test('Prêmios externos de R$ 0: liberação restrita e sem recebimento fictício',async t=>{
 const db=new PGlite(),actor=crypto.randomUUID(),customer=crypto.randomUUID();
 const v=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
 const owner=()=>db.exec('reset role');
 const release=ids=>db.query("select release_external_prize_freight($1,$2,'Prêmio externo da rifa.digital')",[customer,ids]);
 try{
  await loadCommerceDb(db);await db.exec('alter table lots add column paid_at timestamptz');await db.exec(await migration('0050_external_prize_freight_release.sql'));
  await db.query('insert into auth.users values($1)',[actor]);await db.query("insert into admin_profiles values($1,'owner')",[actor]);await db.query("select set_config('test.actor',$1,false)",[actor]);await db.exec("select set_config('test.admin','true',false)");
  await db.query("insert into customers(id,email) values($1,'test@example.invalid')",[customer]);
  const lot=await v("insert into lots(id,customer_id,status,arremate_value,shipping_date,auction_date) values(gen_random_uuid(),$1,'pending_payment',0,current_date,current_date) returning id",[customer]);
  await t.test('liberar prêmio zero é idempotente, sem Pix, data de pagamento ou receita',async()=>{
   await release([lot]);await release([lot]);assert.equal(await v('select status from lots where id=$1',[lot]),'paid');assert.equal(await v('select paid_at from lots where id=$1',[lot]),null);
   assert.equal(Number(await v('select count(*) from external_prize_freight_releases')),1);assert.equal(Number(await v('select count(*) from charges')),0);
   assert.equal(Number(await v('select count(*) from get_due_freight_periods($1)',[customer])),0);
  });
  await t.test('cliente/viewer não libera; IDs duplicados, lote cobrado ou de outro cliente são rejeitados',async()=>{
   await db.exec("set role authenticated;select set_config('test.admin','false',false)");await assert.rejects(release([lot]),/Acesso negado/);await owner();await db.exec("select set_config('test.admin','true',false)");
   await assert.rejects(release([lot,lot]),/apenas prêmios/);
   const other=await v("insert into customers(id,email) values(gen_random_uuid(),'other@example.invalid') returning id");
   const foreign=await v("insert into lots(id,customer_id,status,arremate_value) values(gen_random_uuid(),$1,'paid',0) returning id",[other]);await assert.rejects(release([foreign]),/apenas prêmios/);
   const positive=await v("insert into lots(id,customer_id,status,arremate_value) values(gen_random_uuid(),$1,'paid',50) returning id",[customer]);await assert.rejects(release([positive]),/apenas prêmios/);await db.query("update lots set status='cancelled' where id=$1",[positive]);
   const pix=await v("insert into charges(customer_id,status,freight_amount) values($1,'pending',0) returning id",[customer]);
   const charged=await v("insert into lots(id,customer_id,status,arremate_value,charge_id) values(gen_random_uuid(),$1,'pending_payment',0,$2) returning id",[customer,pix]);await assert.rejects(release([charged]),/apenas prêmios/);
   await db.query("update lots set status='cancelled' where id=$1",[charged]);await db.query("update charges set status='cancelled' where id=$1",[pix]);
  });
  await t.test('etiqueta usa liberação específica sem gastar crédito de frete; valor alterado invalida liberação',async()=>{
   await db.query("insert into charges(customer_id,status,freight_amount,freight_period) values($1,'approved',20,current_date)",[customer]);
   const shipment=await v('insert into shipments(customer_id,batch_date,insurance_value) values($1,current_date,0) returning id',[customer]);await db.query('insert into shipment_lots(shipment_id,lot_id) values($1,$2)',[shipment,lot]);
   await db.exec('set role service_role');await db.query('select bind_shipment_contents($1,$2)',[shipment,JSON.stringify({lots:[{id:lot,value:0}],store:[],logistics:[]})]);await db.query('select assert_shipment_freight($1)',[shipment]);
   await owner();assert.equal(await v('select freight_payer from shipments where id=$1',[shipment]),'company');assert.equal(Number(await v('select count(*) from shipment_freight_usage')),0);
   await db.query('update lots set arremate_value=10 where id=$1',[lot]);await db.exec('set role service_role');await assert.rejects(db.query('select assert_shipment_freight($1)',[shipment]),/Confira/);
  });
  await t.test('hotfix de produção usa bind antigo e aceita declaração/seguro manual sem migration 0051',async()=>{
   await owner();const recipient=crypto.randomUUID();await db.query("insert into customers(id,email) values($1,'prize@example.invalid')",[recipient]);
   const prize=await v("insert into lots(id,customer_id,status,arremate_value,shipping_date,auction_date) values(gen_random_uuid(),$1,'paid',0,current_date,current_date) returning id",[recipient]);
   await db.query("select release_external_prize_freight($1,$2,'Prêmio externo')",[recipient,[prize]]);
   const label=await v('insert into shipments(customer_id,batch_date,insurance_value) values($1,current_date,200) returning id',[recipient]);await db.query('insert into shipment_lots values($1,$2)',[label,prize]);
   await db.exec('set role service_role');await db.query('select bind_store_orders_to_shipment($1)',[label]);await db.query('select assert_shipment_freight($1)',[label]);
   await owner();assert.equal(await v('select freight_payer from shipments where id=$1',[label]),'company');assert.equal(Number(await v('select insurance_value from shipments where id=$1',[label])),200);assert.equal(await v('select content_snapshot from shipments where id=$1',[label]),null);
  });
 }finally{await db.close();}
});
