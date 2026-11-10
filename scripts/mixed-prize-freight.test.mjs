import {test} from 'node:test';import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';import {loadCommerceDb,migration} from './fixtures/commerce-db.mjs';
import fs from 'node:fs';import ts from 'typescript';import vm from 'node:vm';

test('validação local aborta emissão antes de criar etiqueta na transportadora',async()=>{
 const source=ts.createSourceFile('shipments.ts',fs.readFileSync('src/lib/shipments-server.ts','utf8'),ts.ScriptTarget.Latest,true);const fn=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text==='emitShipmentInternal');
 let carts=0;const exports={};const context={exports,Date,console,createAdminClient:()=>({rpc:async name=>({error:name==='validate_shipment_draft'?{code:'P0001',message:'Conteúdo mudou'}:null})}),getOrigin:async()=>({}),loadCustomer:async()=>({}),missingRecipientFields:()=>[],listEligibleShipmentLots:async()=>[{id:'lot',arremate_value:10}],nextShippingDate:()=> '2026-11-10',spToday:()=> '2026-11-10',assertShipmentPayments:async()=>{},listStoreShippingOrders:async()=>[],listLogisticsShippingItems:async()=>[],logisticsDeclaredTotal:()=>0,storeDeclaredTotal:()=>0,round2:Number,shipmentValues:()=>({declaredValue:10,insuranceValue:0}),shipmentContentSnapshot:()=>({lots:[],store:[],logistics:[]}),createCart:async()=>{carts++;throw Error('não deveria chegar');}};
 vm.runInNewContext(ts.transpileModule('exports.emit='+fn.getText(source).replace(/^async function emitShipmentInternal/,'async function'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
 await assert.rejects(exports.emit({customerId:'customer',lotIds:['lot'],batchDate:'2026-11-10'}),/Conteúdo mudou/);assert.equal(carts,0);
});

test('falha depois de criar etiqueta só marca cancelada após confirmação da SuperFrete',async()=>{
 const source=ts.createSourceFile('shipments.ts',fs.readFileSync('src/lib/shipments-server.ts','utf8'),ts.ScriptTarget.Latest,true);const fn=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text==='emitShipmentInternal');
 for(const stage of ["contents","links"]) for(const confirmed of [false,true]){
  const patches=[];let cancels=0,checkouts=0;const exports={};
  const db={rpc:async name=>({error:stage==='contents'&&name==='bind_shipment_contents'?{message:'Conteúdo concorrente'}:null}),from(table){return {insert(){return this},select(){return this},single:async()=>({data:{id:'shipment'},error:null}),update(p){patches.push(p);return this},eq(){return this},then(resolve){return Promise.resolve({error:stage==='links'&&table==='shipment_lots'?{message:'Vínculo concorrente'}:null}).then(resolve)}}}};
  const context={exports,Date,console:{error(){}},createAdminClient:()=>db,getOrigin:async()=>({}),loadCustomer:async()=>({}),missingRecipientFields:()=>[],listEligibleShipmentLots:async()=>[{id:'lot',arremate_value:10}],nextShippingDate:()=> '2026-11-10',spToday:()=> '2026-11-10',assertShipmentPayments:async()=>{},listStoreShippingOrders:async()=>[],listLogisticsShippingItems:async()=>[],logisticsDeclaredTotal:()=>0,storeDeclaredTotal:()=>0,round2:Number,shipmentValues:()=>({declaredValue:10,insuranceValue:0}),shipmentContentSnapshot:()=>({lots:[],store:[],logistics:[]}),createCart:async()=>({id:'cart',price:10}),buildRecipient:()=>({}),sfServiceLabel:()=> 'PAC',cancelOrder:async()=>{cancels++;},getOrderInfo:async()=>({status:confirmed?'canceled':'pending'}),normalizeSfStatus:s=>s==='canceled'?'cancelled':null,checkoutOrders:async()=>{checkouts++;}};
  vm.runInNewContext(ts.transpileModule('exports.emit='+fn.getText(source).replace(/^async function emitShipmentInternal/,'async function'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
  await assert.rejects(exports.emit({customerId:'customer',lotIds:['lot'],batchDate:'2026-11-10'}),confirmed?/cancelada/:/ainda não foi confirmado/);
  assert.equal(cancels,1);assert.equal(checkouts,0);assert.equal(patches.some(p=>p.status==='cancelled'),confirmed);assert.ok(patches.some(p=>p.cancellation_origin==='rollback'));
 }
});

test('liberação de prêmio externo segue válida ao incluir prêmio do app sem movimento',async()=>{
 const db=new PGlite(),actor=crypto.randomUUID(),customer=crypto.randomUUID();const v=async(q,a=[])=>Object.values((await db.query(q,a)).rows[0])[0];
 try{
  await loadCommerceDb(db);for(const f of ['0050_external_prize_freight_release.sql','0051_manual_shipment_declaration.sql','0076_optional_logistics_separation.sql','0077_mixed_prize_freight.sql'])await db.exec(await migration(f));
  await db.exec(await migration('0077_mixed_prize_freight.sql'));
  await db.query('insert into auth.users values($1)',[actor]);await db.query("insert into admin_profiles values($1,'owner')",[actor]);await db.query("select set_config('test.actor',$1,false),set_config('test.admin','true',false)",[actor]);
  await db.query("insert into customers(id,name,email) values($1,'Fixture','test@example.invalid')",[customer]);
  const lot=await v("insert into lots(id,customer_id,status,arremate_value,shipping_date) values(gen_random_uuid(),$1,'paid',0,current_date) returning id",[customer]);await db.query("select release_external_prize_freight($1,$2,'Prêmio externo liberado')",[customer,[lot]]);
  const campaign=await v("insert into raffle_campaigns(title,description,total_numbers,unit_price,selection_mode,draw_method,draw_rules,created_by,max_quantity) values('Fixture','Regulamento teste',10,10,'both','external','Sorteio externo',$1,10) returning id",[actor]);
  const order=await v("insert into raffle_orders(campaign_id,customer_id,request_key,amount,numbers,status) values($1,$2,gen_random_uuid(),10,array[0],'paid') returning id",[campaign,customer]);const prize=await v("insert into raffle_prizes(campaign_id,title,kind,number) values($1,'Prêmio','instant',0) returning id",[campaign]);
  const issue=await v("insert into logistics_pending(customer_id,title,quantity,reason,shipping_date,created_by,source_kind) values($1,'Prêmio',1,'Rifa',current_date,$2,'raffle') returning id",[customer,actor]);await db.query('insert into raffle_awards(prize_id,campaign_id,order_id,customer_id,number,logistics_id) values($1,$2,$3,$4,0,$5)',[prize,campaign,order,customer,issue]);
  const replacement=await v("insert into logistics_pending(customer_id,title,quantity,reason,shipping_date,created_by,source_kind) values($1,'Reposição',1,'Erro logístico',current_date,$2,'replacement') returning id",[customer,actor]);
  const expected={lots:[{id:lot,value:0}],store:[],logistics:[{id:issue,value:0},{id:replacement,value:0}],declared_value:150};
  await db.exec('set role authenticated');await assert.rejects(db.query('select validate_shipment_draft($1,current_date,$2)',[customer,JSON.stringify(expected)]),/permission denied/);
  await db.exec('reset role;set role service_role');await db.query('select validate_shipment_draft($1,current_date,$2)',[customer,JSON.stringify(expected)]);await assert.rejects(db.query('select validate_shipment_draft($1,current_date,$2)',[customer,JSON.stringify({...expected,logistics:[]})]),/conteúdo do pacote mudou/);
  await db.exec('reset role');const shipment=await v('insert into shipments(customer_id,batch_date,insurance_value) values($1,current_date,150) returning id',[customer]);await db.query('insert into shipment_lots values($1,$2)',[shipment,lot]);
  assert.equal(await v('select is_company_prize_package($1)',[shipment]),false);
  await db.exec(await migration('0080_company_prize_replacement_freight.sql'));
  assert.equal(await v('select is_company_prize_package($1)',[shipment]),true);
  await db.exec('set role service_role');await db.query('select bind_shipment_contents($1,$2)',[shipment,JSON.stringify(expected)]);await db.query('select assert_shipment_freight($1)',[shipment]);
  await db.exec('reset role');assert.equal(await v('select freight_payer from shipments where id=$1',[shipment]),'company');assert.equal(Number(await v('select count(*) from charges')),0);assert.equal(Number(await v('select count(*) from shipment_freight_usage')),0);
  const solo=await v('insert into shipments(customer_id,batch_date) values($1,current_date) returning id',[customer]);
  await db.query("insert into logistics_pending(customer_id,title,quantity,reason,shipping_date,created_by,source_kind) values($1,'Reposição isolada',1,'Teste',current_date,$2,'replacement')",[customer,actor]);
  assert.equal(await v('select is_company_prize_package($1)',[solo]),false);
  await db.query("update raffle_orders set status='review' where id=$1",[order]);await db.exec('set role service_role');await assert.rejects(db.query('select assert_shipment_freight($1)',[shipment]),/Confira/);
 }finally{await db.close();}
});
