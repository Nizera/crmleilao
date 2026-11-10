import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {loadCommerceDb,migration} from './fixtures/commerce-db.mjs';
import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';

test('itens avulsos sem movimento ou valor individual entram na soma sem inventar valores',()=>{
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/shipment-content.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
 assert.equal(exports.logisticsDeclaredTotal([{id:'a',source_kind:'raffle',moved_at:null,shipping_declared_value:0},{id:'b',source_kind:'replacement',moved_at:null,shipping_declared_value:15}]),15);
 assert.throws(()=>exports.logisticsDeclaredTotal([{id:'a',source_kind:'raffle',moved_at:null,shipping_declared_value:-1}]),/valor declarado/);
});

test('emissão sem separação conserva bloqueios financeiros, snapshot e segurança',async t=>{
 const db=new PGlite(),actor=crypto.randomUUID();
 const v=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
 const owner=()=>db.exec('reset role');const service=async()=>{await owner();await db.exec('set role service_role');};
 const create=async()=>{
  await owner();const customer=await v("insert into customers(id,name,email) values(gen_random_uuid(),'Fixture','test@example.invalid') returning id");
  const campaign=await v("insert into raffle_campaigns(title,description,total_numbers,unit_price,selection_mode,draw_method,draw_rules,created_by,max_quantity) values('Fixture','Regulamento teste',10,10,'both','external','Sorteio externo',$1,10) returning id",[actor]);
  const order=await v("insert into raffle_orders(campaign_id,customer_id,request_key,amount,numbers,status) values($1,$2,gen_random_uuid(),10,array[0],'paid') returning id",[campaign,customer]);
  const prize=await v("insert into raffle_prizes(campaign_id,title,kind,number) values($1,'Prêmio','instant',0) returning id",[campaign]);
  const issue=await v("insert into logistics_pending(customer_id,title,quantity,reason,shipping_date,created_by,source_kind) values($1,'Prêmio',1,'Rifa',current_date,$2,'raffle') returning id",[customer,actor]);
  await db.query('insert into raffle_awards(prize_id,campaign_id,order_id,customer_id,number,logistics_id) values($1,$2,$3,$4,0,$5)',[prize,campaign,order,customer,issue]);
  const shipment=await v('insert into shipments(customer_id,batch_date,insurance_value) values($1,current_date,50) returning id',[customer]);
  return {customer,order,issue,shipment,snapshot:{lots:[],store:[],logistics:[{id:issue,value:0}],declared_value:50}};
 };
 try{
  await loadCommerceDb(db);await db.exec(await migration('0051_manual_shipment_declaration.sql'));await db.exec(await migration('0076_optional_logistics_separation.sql'));await db.exec(await migration('0076_optional_logistics_separation.sql'));
  await db.query('insert into auth.users values($1)',[actor]);await db.query("insert into admin_profiles values($1,'owner')",[actor]);
  await t.test('prêmio não movimentado e sem valor individual pode sair com declaração do pacote',async()=>{
   const x=await create();
   const future=await v("insert into logistics_pending(customer_id,title,quantity,reason,shipping_date,created_by) values($1,'Futuro',1,'Outra data',current_date+7,$2) returning id",[x.customer,actor]);
   await service();await db.query('select bind_shipment_contents($1,$2)',[x.shipment,JSON.stringify(x.snapshot)]);await db.query('select assert_shipment_freight($1)',[x.shipment]);
   await owner();assert.equal(await v('select shipment_id from logistics_pending where id=$1',[future]),null);
   await owner();assert.equal(await v('select shipment_id from logistics_pending where id=$1',[x.issue]),x.shipment);assert.equal(await v('select moved_at from logistics_pending where id=$1',[x.issue]),null);assert.equal(Number(await v('select shipping_declared_value from logistics_pending where id=$1',[x.issue])),0);assert.equal(await v('select freight_payer from shipments where id=$1',[x.shipment]),'company');assert.deepEqual(await v('select content_snapshot from shipments where id=$1',[x.shipment]),x.snapshot);
   await db.query("update raffle_orders set status='review' where id=$1",[x.order]);await service();await assert.rejects(db.query('select assert_shipment_freight($1)',[x.shipment]),/conteúdo e o pagamento/);
  });
  await t.test('lotes não pagos continuam bloqueando, reposição sem movimento entra sem marcar como separada',async()=>{
   const x=await create();const lot=await v("insert into lots(id,customer_id,status,arremate_value,shipping_date) values(gen_random_uuid(),$1,'pending_payment',20,current_date) returning id",[x.customer]);
   await service();await assert.rejects(db.query('select bind_shipment_contents($1,$2)',[x.shipment,JSON.stringify(x.snapshot)]),/pendente|pagamento/i);
   await owner();await db.query("update lots set status='paid' where id=$1",[lot]);await db.query('insert into shipment_lots values($1,$2)',[x.shipment,lot]);
   const replacement=await v("insert into logistics_pending(customer_id,title,quantity,reason,shipping_date,created_by) values($1,'Reposição',1,'Faltou no pacote',current_date,$2) returning id",[x.customer,actor]);
   const snapshot={...x.snapshot,lots:[{id:lot,value:20}],logistics:[...x.snapshot.logistics,{id:replacement,value:0}]};
   await db.query("insert into charges(customer_id,status,freight_amount,freight_period) values($1,'approved',20,current_date)",[x.customer]);
   await service();await assert.rejects(db.query('select bind_shipment_contents($1,$2)',[x.shipment,JSON.stringify(x.snapshot)]),/conteúdo do pacote mudou/);await db.query('select bind_shipment_contents($1,$2)',[x.shipment,JSON.stringify(snapshot)]);
   await owner();assert.equal(await v('select shipment_id from logistics_pending where id=$1',[replacement]),x.shipment);assert.equal(await v('select moved_at from logistics_pending where id=$1',[replacement]),null);assert.equal(await v('select status from lots where id=$1',[lot]),'paid');
  });
  await t.test('movimentar prêmio com zero é permitido só à equipe; estorno continua protegido',async()=>{
   const x=await create();await db.exec("set role authenticated;select set_config('test.admin','false',false)");await assert.rejects(db.query('select box_raffle_award($1,0)',[x.issue]),/Acesso negado/);await assert.rejects(db.query('select bind_shipment_contents($1,$2)',[x.shipment,JSON.stringify(x.snapshot)]),/permission denied/);
   await owner();await db.query("select set_config('test.actor',$1,false)",[actor]);await db.exec("set role authenticated;select set_config('test.admin','true',false)");await db.query('select box_raffle_award($1,0)',[x.issue]);
   await owner();assert.ok(await v('select moved_at from logistics_pending where id=$1',[x.issue]));assert.equal(Number(await v('select shipping_declared_value from logistics_pending where id=$1',[x.issue])),0);
   await db.query("update raffle_orders set status='review' where id=$1",[x.order]);await assert.rejects(db.query('select box_raffle_award($1,0)',[x.issue]),/pagamento/);
  });
 }finally{await db.close();}
});
