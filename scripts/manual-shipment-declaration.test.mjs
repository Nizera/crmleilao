import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {loadCommerceDb,migration} from './fixtures/commerce-db.mjs';
test('declaração manual congela valor no envio sem alterar lote ou financeiro',async()=>{
 const db=new PGlite(),customer=crypto.randomUUID(),lot=crypto.randomUUID();
 const v=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
 try{
  await loadCommerceDb(db);await db.exec(await migration('0051_manual_shipment_declaration.sql'));
  await db.query("insert into customers(id,name,email) values($1,'Fixture','test@example.invalid')",[customer]);
  await db.query("insert into charges(customer_id,status,freight_amount,freight_period) values($1,'approved',20,current_date)",[customer]);
  await db.query("insert into lots(id,customer_id,status,arremate_value,shipping_date) values($1,$2,'paid',0,current_date)",[lot,customer]);
  const shipment=await v('insert into shipments(customer_id,batch_date,insurance_value) values($1,current_date,200) returning id',[customer]);await db.query('insert into shipment_lots values($1,$2)',[shipment,lot]);
  const expected={store:[],logistics:[],lots:[{id:lot,value:0}],declared_value:200};
  await db.exec('set role authenticated');await assert.rejects(db.query('select bind_shipment_contents($1,$2)',[shipment,JSON.stringify(expected)]),/permission denied/);
  await db.exec('reset role;set role service_role');
  await assert.rejects(db.query('select bind_shipment_contents($1,$2)',[shipment,JSON.stringify({...expected,declared_value:100})]),/seguro/);
  await db.query('select bind_shipment_contents($1,$2)',[shipment,JSON.stringify(expected)]);assert.equal(Number(await v('select bind_shipment_contents($1,$2)',[shipment,JSON.stringify(expected)])),0);
  await db.exec('reset role');assert.deepEqual(await v('select content_snapshot from shipments where id=$1',[shipment]),expected);assert.equal(Number(await v('select arremate_value from lots where id=$1',[lot])),0);assert.equal(Number(await v('select count(*) from charges')),1);assert.equal(Number(await v('select count(*) from loyalty_ledger')),0);
 }finally{await db.close();}
});
