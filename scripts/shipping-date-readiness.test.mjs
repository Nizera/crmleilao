import {test} from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import {loadCommerceDb,migration} from './fixtures/commerce-db.mjs';
test('pagamento e Pix de outro envio não bloqueiam a data atual; frete por fora é auditado e idempotente',async()=>{
 const db=new PGlite(),customer=crypto.randomUUID(),actor=crypto.randomUUID();const v=async(q,a=[])=>Object.values((await db.query(q,a)).rows[0])[0];
 try{
  await loadCommerceDb(db);await db.exec('alter table charges add column if not exists description text,add column if not exists created_by uuid,add column if not exists external_reference text unique');
  for(const f of ['0050_external_prize_freight_release.sql','0051_manual_shipment_declaration.sql','0076_optional_logistics_separation.sql','0077_mixed_prize_freight.sql','0078_shipping_date_and_external_receipts.sql'])await db.exec(await migration(f));
  await db.query('insert into auth.users values($1)',[actor]);await db.query("insert into admin_profiles values($1,'owner')",[actor]);await db.query("insert into customers(id,name,email) values($1,'Fixture','test@example.invalid')",[customer]);
  const lot=await v("insert into lots(id,customer_id,status,arremate_value,shipping_date) values(gen_random_uuid(),$1,'paid',100,'2026-11-10') returning id",[customer]);
  const futureCharge=await v("insert into charges(customer_id,status,amount,freight_amount,freight_period) values($1,'pending',635,20,'2026-11-17') returning id",[customer]);
  await db.query("insert into lots(id,customer_id,status,arremate_value,shipping_date,charge_id) values(gen_random_uuid(),$1,'pending_payment',615,'2026-11-17',$2)",[customer,futureCharge]);
  // Evita criar recebimento por fora enquanto outro Pix de frete puder ser pago.
  await db.query("select set_config('test.actor',$1,false),set_config('test.admin','false',false)",[actor]);await db.exec('set role authenticated');await assert.rejects(db.query("select record_external_freight_payment($1,'2026-11-10','Confirmado por fora')",[customer]),/Acesso negado/);
  await db.exec("reset role;select set_config('test.admin','true',false)");
  const currentCharge=await v("insert into charges(customer_id,status,amount,freight_amount,freight_period) values($1,'pending',20,20,'2026-11-10') returning id",[customer]);
  await assert.rejects(db.query("select record_external_freight_payment($1,'2026-11-10','Confirmado por fora')",[customer]),/Pix de frete em aberto/);
  await db.query("update charges set status='cancelled' where id=$1",[currentCharge]);
  const receipt=await v("select record_external_freight_payment($1,'2026-11-10','Frete recebido por fora')",[customer]);assert.equal(await v("select record_external_freight_payment($1,'2026-11-10','Frete recebido por fora')",[customer]),receipt);
  assert.equal(Number(await v('select count(*) from charges where status=\'approved\'')),1);assert.equal(await v('select paid_at from charges where id=$1',[receipt]),null);assert.equal(await v('select created_by from charges where id=$1',[receipt]),actor);
  await db.exec('set role service_role');await db.query("select assert_customer_shipping_ready_for_date($1,'2026-11-10')",[customer]);await assert.rejects(db.query("select assert_customer_shipping_ready_for_date($1,'2026-11-17')",[customer]),/lotes pendentes/);
  await db.exec('reset role');const label=await v("insert into shipments(customer_id,batch_date,insurance_value) values($1,'2026-11-10',100) returning id",[customer]);await db.query('insert into shipment_lots values($1,$2)',[label,lot]);
  const snapshot={lots:[{id:lot,value:100}],store:[],logistics:[]};await db.exec('set role service_role');await db.query("select validate_shipment_draft($1,'2026-11-10',$2)",[customer,JSON.stringify(snapshot)]).catch(e=>{assert.match(e.message,/conteúdo.*mudou/);});
  await db.query('select bind_shipment_contents($1,$2)',[label,JSON.stringify(snapshot)]);await db.query('select assert_shipment_freight($1)',[label]);
  await db.exec('reset role');assert.equal(Number(await v('select count(*) from shipment_freight_usage where charge_id=$1',[receipt])),1);assert.equal(Number(await v("select count(*) from lots where customer_id=$1 and status='pending_payment'",[customer])),1);assert.equal(await v('select status from charges where id=$1',[futureCharge]),'pending');
 }finally{await db.close();}
});
