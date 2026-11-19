import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {loadCommerceDb,migration} from './fixtures/commerce-db.mjs';

test('frete automático de lotes zerados: sem crédito fictício e novo arremate cobrado',async t=>{
 const db=new PGlite();
 const v=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
 const customer=async()=>{const id=crypto.randomUUID();await db.query("insert into customers(id,email) values($1,'fixture@example.invalid')",[id]);return id;};
 const lot=async(c,value,status='paid')=>v('insert into lots(id,customer_id,status,arremate_value,shipping_date,auction_date) values(gen_random_uuid(),$1,$2,$3,current_date,current_date) returning id',[c,status,value]);
 const label=async(c,ids)=>{const id=await v('insert into shipments(customer_id,batch_date,insurance_value) values($1,current_date,0) returning id',[c]);for(const lot of ids)await db.query('insert into shipment_lots values($1,$2)',[id,lot]);return id;};
 const due=async c=>Number(await v('select count(*) from get_due_freight_periods($1)',[c]));
 try{
  await loadCommerceDb(db);
  await db.exec('alter table lots add column paid_at timestamptz');
  for(const file of ['0050_external_prize_freight_release.sql','0051_manual_shipment_declaration.sql','0077_mixed_prize_freight.sql','0080_company_prize_replacement_freight.sql','20261119182352_automatic_zero_lot_freight.sql'])await db.exec(await migration(file));
  // loadCommerceDb skips this trigger from 0029; exercise the real production guard too.
  await db.exec('create trigger require_lot_period_freight before update of charge_id on lots for each row execute function public.require_lot_period_freight()');

  await t.test('somente zerados não cobram; um arremate novo volta a exigir R$20',async()=>{
   const c=await customer(),zero=await lot(c,0);
   assert.equal(await due(c),0);
   await db.query("select set_config('test.customer',$1,false)",[c]);
   assert.equal((await v('select get_customer_freight_summary()')).status,'none');
   const positive=await lot(c,35,'pending_payment');
   assert.equal(await due(c),1);
   const charge=await v('insert into charges(customer_id) values($1) returning id',[c]);
   assert.equal(Number(await v('select reserve_charge_freights($1,$2::uuid[])',[charge,[positive]])),20);
   assert.equal(Number(await v('select amount from charges where id=$1',[charge])),55);
   // Zero-value lots do not bypass the positive lot's existing Pix freight guard.
   await db.query('update lots set charge_id=$1 where id=any($2::uuid[])',[charge,[zero,positive]]);
   assert.equal(Number(await v('select count(*) from external_prize_freight_releases')),0);
  });

  await t.test('envio gratuito não cria nem gasta crédito; compra posterior exige novo frete',async()=>{
   const c=await customer(),zero=await lot(c,0),s=await label(c,[zero]);
   await db.query('select bind_shipment_contents($1,$2::jsonb)',[s,JSON.stringify({lots:[{id:zero,value:0}],store:[],logistics:[]})]);
   await db.query('select assert_shipment_freight($1)',[s]);
   assert.equal(await v('select freight_payer from shipments where id=$1',[s]),'company');
   assert.equal(Number(await v('select count(*) from shipment_freight_usage where customer_id=$1',[c])),0);
   assert.equal(Number(await v('select count(*) from charges where customer_id=$1',[c])),0);
   assert.equal(Number(await v('select count(*) from available_shipment_freight($1)',[c])),0);
   const positive=await lot(c,50);
   assert.equal(await due(c),1);
   assert.equal(await v('select is_company_prize_package($1)',[s]),true,'pacote congelado não muda por compra posterior');
   const next=await label(c,[positive]);
   assert.equal(await v('select is_company_prize_package($1)',[next]),false);
   await assert.rejects(db.query('select claim_shipment_freight($1)',[next]),/frete.*não foi pago/);
   await db.query('update lots set arremate_value=10 where id=$1',[zero]);
   await assert.rejects(db.query('select assert_shipment_freight($1)',[s]),/Confira/);
  });

  await t.test('pacote misto cobra uma vez e zerado não consome crédito já pago',async()=>{
   const c=await customer(),zero=await lot(c,0),credit=await v("insert into charges(customer_id,status,freight_amount,freight_period) values($1,'approved',20,current_date) returning id",[c]);
   const free=await label(c,[zero]);await db.query('select claim_shipment_freight($1)',[free]);
   assert.equal(Number(await v('select count(*) from available_shipment_freight($1)',[c])),1);
   await db.query("update shipments set status='cancelled' where id=$1",[free]);
   const positive=await lot(c,40),mixed=await label(c,[zero,positive]);
   assert.equal(await v('select is_company_prize_package($1)',[mixed]),false);
   await db.query('select claim_shipment_freight($1)',[mixed]);await db.query('select assert_shipment_freight($1)',[mixed]);
   assert.equal(await v('select freight_payer from shipments where id=$1',[mixed]),'customer');
   assert.equal(await v('select charge_id from shipment_freight_usage where shipment_id=$1',[mixed]),credit);
   assert.equal(Number(await v('select count(*) from available_shipment_freight($1)',[c])),0);
  });

  await t.test('compra física da loja impede isenção; controles privados e de pagamento permanecem',async()=>{
   const c=await customer(),zero=await lot(c,0),s=await label(c,[zero]);
   const product=await v("insert into loyalty_rewards(name,cash_price,stock,internal_cost,active) values('Produto',80,1,1,true) returning id");
   const order=await v("insert into store_orders(customer_id,request_key,external_reference,cash_total,coins_total,payment_status,fulfillment_status) values($1,gen_random_uuid(),'shop_'||gen_random_uuid(),80,0,'paid','processing') returning id",[c]);
   await db.query("insert into store_order_items(order_id,reward_id,name,quantity,price_mode,unit_cash,unit_coins,reserved_stock) values($1,$2,'Produto',1,'cash',80,0,true)",[order,product]);
   assert.equal(await v('select is_company_prize_package($1)',[s]),false);
   const pending=await customer(),pendingZero=await lot(pending,0,'pending_payment');
   assert.equal(await due(pending),0);await assert.rejects(db.query('select assert_customer_shipping_ready($1)',[pending]),/pendente/);
   const zeroCharge=await v('insert into charges(customer_id) values($1) returning id',[pending]);
   await db.query('update lots set charge_id=$1 where id=$2',[zeroCharge,pendingZero]);
   const positive=await lot(pending,1,'pending_payment');
   await assert.rejects(db.query('update lots set charge_id=$1 where id=$2',[zeroCharge,positive]),/frete.*acompanhar/);
   await db.exec('set role authenticated');
   await assert.rejects(db.query('select is_company_prize_package($1)',[s]),/permission denied/);
   await assert.rejects(db.query('select * from get_due_freight_periods_before_checkout($1)',[c]),/permission denied/);
   await db.exec('reset role');
  });
 }finally{await db.close();}
});
