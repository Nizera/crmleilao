import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { loadCommerceDb, migration } from './fixtures/commerce-db.mjs';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

test('motoboy consome um frete na saída e cobra o próximo; encerramento, cancelamento e segurança', async () => {
 const db=new PGlite(), customer=crypto.randomUUID(), other=crypto.randomUUID(), actor=crypto.randomUUID();
 const v=async(q,a=[])=>Object.values((await db.query(q,a)).rows[0])[0];
 try {
 await loadCommerceDb(db);
 await db.exec(`alter table charges add column if not exists description text,add column if not exists created_by uuid,add column if not exists external_reference text unique;
 alter table customers add column address_complement text;
 alter table lots add column shipped_at timestamptz,add column payment_due_at timestamptz;
 alter table shipments add column sf_order_id text not null default 'provider-fixture',add column service_name text,add column carrier text,add column volume jsonb,add column address jsonb,add column created_by uuid,
 add column tracking_url text,add column label_print_url text,add column posted_at timestamptz,add column delivered_at timestamptz,add column cancelled_at timestamptz,add column events jsonb not null default '[]',
 add column price numeric,add column original_price numeric,add column price_baseline_legacy boolean default false,add column price_change_count integer default 0,add column price_difference numeric;
 `);
 for(const file of ['0050_external_prize_freight_release.sql','0051_manual_shipment_declaration.sql','0076_optional_logistics_separation.sql','0077_mixed_prize_freight.sql','0078_shipping_date_and_external_receipts.sql','0080_company_prize_replacement_freight.sql','0085_local_deliveries.sql'])await db.exec(await migration(file));
 await db.exec(await migration('0085_local_deliveries.sql'));
 await db.query('insert into auth.users values($1)',[actor]);await db.query("insert into admin_profiles values($1,'owner')",[actor]);
 await db.query("select set_config('test.actor',$1,false),set_config('test.admin','true',false)",[actor]);
 for(const id of [customer,other])await db.query("insert into customers(id,name,email,phone_e164,address_street,address_number,address_city) values($1,'Cliente Teste','test@example.invalid','+5511999999999','Rua Teste','1','Cidade')",[id]);
 const first=await v("insert into lots(id,customer_id,status,arremate_value,shipping_date,payment_due_at) values(gen_random_uuid(),$1,'paid',80,'2099-11-17','2099-11-17T20:00:00Z') returning id",[customer]);
 const receipt=await v("insert into charges(customer_id,status,freight_amount,amount,paid_at) values($1,'approved',20,100,now()) returning id",[customer]);
 await db.exec("update loyalty_settings set active=false where id");
 const reward=await v("insert into loyalty_rewards(name,points_cost,internal_cost,stock) values('Produto físico',100,20,5) returning id");
 const shop=await v("insert into store_orders(customer_id,request_key,external_reference,cash_total,coins_total,payment_status,fulfillment_status,shipping_declared_value,boxed_at) values($1,gen_random_uuid(),gen_random_uuid()::text,40,0,'paid','processing',40,now()) returning id",[customer]);
 await db.query("insert into store_order_items(order_id,reward_id,name,quantity,price_mode,unit_cash,unit_coins,reserved_stock,delivery_kind) values($1,$2,'Produto físico',1,'cash',40,0,true,'physical')",[shop,reward]);
 const req=crypto.randomUUID(), snapshot={lots:[{id:first,value:80}],store:[{id:shop,value:40}],logistics:[]};
 const create=()=>v("select create_local_delivery($1,'2099-11-17',$2,$3,'À tarde')",[customer,JSON.stringify(snapshot),req]);
 await db.exec("set role authenticated;select set_config('test.admin','false',false)");await assert.rejects(create(),/Acesso negado/);
 await db.exec("select set_config('test.admin','true',false);select set_config('test.readonly','true',false)");await assert.rejects(create(),/Acesso negado/);
 await db.exec("select set_config('test.readonly','false',false)");
 await db.exec('reset role');
 const unpaid=await v("insert into lots(id,customer_id,status,arremate_value,shipping_date) values(gen_random_uuid(),$1,'pending_payment',30,'2099-11-17') returning id",[customer]);
 await assert.rejects(create(),/pendentes de pagamento/);assert.equal(await v('select count(*)::int from shipments'),0);
 await db.query("update lots set status='cancelled' where id=$1",[unpaid]);
 await db.exec('set role authenticated');
 const shipment=await create();assert.equal(await create(),shipment);
 await assert.rejects(v("select create_local_delivery($1,'2099-11-17',$2,$3,'')",[customer,JSON.stringify(snapshot),crypto.randomUUID()]),/conteúdo|mudou/i);
 await db.exec('reset role');
 assert.equal(await v('select status from shipments where id=$1',[shipment]),'posted');
 assert.equal(await v('select sf_order_id from shipments where id=$1',[shipment]),null);
 assert.equal(await v('select status from lots where id=$1',[first]),'shipped');
 assert.equal(await v('select shipment_id from store_orders where id=$1',[shop]),shipment);
 assert.equal(await v('select count(*)::int from shipment_freight_usage where charge_id=$1 and shipment_id=$2',[receipt,shipment]),1);
 assert.equal(await v('select count(*)::int from available_shipment_freight($1)',[customer]),0);
 assert.equal(await v('select count(*)::int from shipments'),1);
 await db.exec('set role anon');await assert.rejects(create(),/permission denied|Acesso negado/);await db.exec('reset role');
 assert.equal((await db.query('select get_shipment_cost_summary() as result')).rows[0].result.labels,0);
 // A nova semana passa a dever exatamente um frete; não depende de marcar entregue.
 const next=await v("insert into lots(id,customer_id,status,arremate_value,shipping_date) values(gen_random_uuid(),$1,'paid',50,'2099-11-24') returning id",[customer]);
 assert.equal(Number(await v('select freight_amount from get_due_freight_periods($1)',[customer])),20);
 const nextSnap={lots:[{id:next,value:50}],store:[],logistics:[]};
 await assert.rejects(v("select create_local_delivery($1,'2099-11-24',$2,$3,'')",[customer,JSON.stringify(nextSnap),crypto.randomUUID()]),/frete|pago/i);
 assert.equal(await v('select count(*)::int from shipments'),1);
 // Não permite capturar outro cliente, trocar conteúdo com o mesmo request ou entregar pacote SuperFrete.
 await assert.rejects(v("select create_local_delivery($1,'2099-11-17',$2,$3,'')",[other,JSON.stringify(snapshot),req]),/indisponível/);
 await db.query("select handle_local_delivery($1,'delivered')",[shipment]);await db.query("select handle_local_delivery($1,'delivered')",[shipment]);
 assert.equal(await v('select status from lots where id=$1',[first]),'delivered');
 assert.equal(await v('select fulfillment_status from store_orders where id=$1',[shop]),'fulfilled');
 assert.ok(await v('select delivered_at from shipments where id=$1',[shipment]));
 await assert.rejects(db.query("select handle_local_delivery($1,'cancel')",[shipment]),/não permite/);
 // Uma segunda entrega pode ser cancelada: libera os itens e crédito, sem recriar recebimentos.
 await db.query("insert into charges(customer_id,status,freight_amount,amount,paid_at) values($1,'approved',20,20,now())",[customer]);
 const issue=await v("select create_logistics_pending($1,'Reposição',1,'Item que ficou fora','2099-11-24')",[customer]);
 nextSnap.logistics.push({id:issue,value:0});
 const second=await v("select create_local_delivery($1,'2099-11-24',$2,$3,'')",[customer,JSON.stringify(nextSnap),crypto.randomUUID()]);
 await db.query("select handle_local_delivery($1,'cancel')",[second]);await db.query("select handle_local_delivery($1,'cancel')",[second]);
 assert.equal(await v('select status from lots where id=$1',[next]),'paid');
 assert.equal(await v('select shipment_id from logistics_pending where id=$1',[issue]),null);
 assert.equal(await v('select count(*)::int from available_shipment_freight($1)',[customer]),1);
 assert.equal(await v('select count(*)::int from charges'),2);
 assert.equal((await v('select payment_due_at from lots where id=$1',[first])).toISOString(),'2099-11-17T20:00:00.000Z');
 } finally { await db.close(); }
});

test('ações de transportadora bloqueiam motoboy antes de chamar a API',async()=>{
 const source=ts.createSourceFile('shipments.ts',fs.readFileSync('src/lib/shipments-server.ts','utf8'),ts.ScriptTarget.Latest,true);
 for(const name of ['payShipment','syncShipment','cancelShipment','refreshPrintUrl']){
  const fn=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);const exports={};let calls=0;
  const provider=async()=>{calls++;throw Error('provider called');};
  vm.runInNewContext(ts.transpileModule(`exports.run=${fn.getText(source).replace('export ','')}`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,getShipmentById:async()=>({delivery_method:'motoboy',sf_order_id:null,status:'posted'}),checkoutOrders:provider,getOrderInfo:provider,cancelOrder:provider,tagPrintUrl:provider});
  await assert.rejects(exports.run('id'),/entrega própria/);assert.equal(calls,0);
 }
});
