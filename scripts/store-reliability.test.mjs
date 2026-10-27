import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import ts from 'typescript';
import {createHmac} from 'node:crypto';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');
async function mpModule(){
 const source=(await read('../src/lib/mercadopago.ts')).replace('import "server-only";','').replace('import { siteUrl } from "@/lib/lots";','const siteUrl=()=>"https://example.invalid";');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
test('Pix: ID preservado sem QR, UTC correto, retomada por GET e timeout propagado',async()=>{
 const {createPixOrder,getOrder}=await mpModule(); const original=globalThis.fetch; const token=process.env.MP_ACCESS_TOKEN;
 process.env.MP_ACCESS_TOKEN='fake-test-token';const calls=[];
 try{
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json({id:'ORD_recovery',status:'processing',total_amount:'10.00',external_reference:'shop_fixture',transactions:{payments:[{}]}});};
  const before=Date.now();const order=await createPixOrder({amount:10,description:'fixture',externalReference:'shop_fixture',payerEmail:'fixture@example.invalid'},{waitForQr:false});
  assert.equal(order.orderId,'ORD_recovery');assert.equal(order.qrCode,null);assert.equal(calls.length,1);
  assert.ok(Math.abs(Date.parse(order.dateOfExpiration)-before-3*86400000)<1000);
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json({id:'ORD_recovery',status:'action_required',total_amount:'10.00',external_reference:'shop_fixture',transactions:{payments:[{payment_method:{qr_code:'fake-qr'}}]}});};
  const synced=await getOrder(order.orderId);assert.equal(synced.raw.transactions.payments[0].payment_method.qr_code,'fake-qr');
  assert.equal(calls.filter(c=>c.options.method==='POST').length,1);
  globalThis.fetch=async(_url,options)=>{options.signal.throwIfAborted();throw new Error('expected abort');};
  await assert.rejects(createPixOrder({amount:10,description:'fixture',externalReference:'shop_fixture',payerEmail:'fixture@example.invalid'},{signal:AbortSignal.abort(),waitForQr:false}),/abort/i);
 }finally{globalThis.fetch=original;if(token===undefined)delete process.env.MP_ACCESS_TOKEN;else process.env.MP_ACCESS_TOKEN=token;}
});

test('Webhook: HMAC obrigatório, valor consultado no provedor e replay encaminhado com segurança',async()=>{
 let consulted=0,settled=0;
 globalThis.__webhookAudit={getOrder:async()=>{consulted++;return {id:'ORD_fixture',externalReference:'shop_fixture',status:'processed',statusDetail:'accredited',amount:10};},settleStoreMpOrder:async()=>{settled++;return {ok:true};}};
 let source=await read('../src/app/api/webhooks/mercadopago/[token]/route.ts');
 source=source.replace('import { revalidatePath, revalidateTag } from "next/cache";','const revalidatePath=()=>{};const revalidateTag=()=>{};')
  .replace('import { settleChargeByReference } from "@/lib/charges-server";','const settleChargeByReference=async()=>({ok:true});')
  .replace('import { getOrder, targetChargeStatus } from "@/lib/mercadopago";','const {getOrder}=globalThis.__webhookAudit;const targetChargeStatus=()=>"approved";')
  .replace('import { settleStoreMpOrder } from "@/lib/store-server";','const {settleStoreMpOrder}=globalThis.__webhookAudit;');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 const {POST}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
 const previous={token:process.env.MP_WEBHOOK_TOKEN,secret:process.env.MP_WEBHOOK_SECRET};process.env.MP_WEBHOOK_TOKEN='fake-webhook-path';process.env.MP_WEBHOOK_SECRET='fake-hmac-secret';
 const request=(signature)=>{const req=new Request('https://example.invalid/webhook',{method:'POST',headers:{'content-type':'application/json','x-request-id':'fixture-request',...(signature?{'x-signature':signature}:{})},body:JSON.stringify({type:'order',data:{id:'ORD_fixture'}})});req.nextUrl=new URL(req.url);return req;};
 const params={params:Promise.resolve({token:'fake-webhook-path'})};
 try{
  assert.equal((await POST(request(),params)).status,401);assert.equal(consulted,0);
  const timestamp=String(Date.now());const digest=createHmac('sha256','fake-hmac-secret').update(`id:ord_fixture;request-id:fixture-request;ts:${timestamp};`).digest('hex');
  assert.equal((await POST(request(`ts=${timestamp},v1=wrong`),params)).status,401);assert.equal(consulted,0);
  const signature=`ts=${timestamp},v1=${digest}`;
  assert.equal((await POST(request(signature),params)).status,200);assert.equal((await POST(request(signature),params)).status,200);
  assert.equal(consulted,2);assert.equal(settled,2); // idempotência financeira é exercitada no PostgreSQL.
  delete process.env.MP_WEBHOOK_SECRET;assert.equal((await POST(request(signature),params)).status,503);assert.equal(consulted,2);
 }finally{for(const [name,value]of [['MP_WEBHOOK_TOKEN',previous.token],['MP_WEBHOOK_SECRET',previous.secret]]){if(value===undefined)delete process.env[name];else process.env[name]=value;}delete globalThis.__webhookAudit;}
});

test('Loja: falha após criar não perde ID e QR é atualizado sem outro POST',async()=>{
 let posts=0,gets=0;const state={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',customer_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',external_reference:'shop_fixture',code:'LJ-fixture',payment_status:'creating',mp_order_id:null,cash_total:10,items:[]};
 const db={from(table){let values;return {select(){return this;},update(v){values=v;return this;},eq(){return this;},or(){return this;},single:async()=>({data:{email:'fixture@example.invalid',name:'Fixture'}}),then(resolve){if(table==='store_orders'&&values)Object.assign(state,values);return Promise.resolve({error:null}).then(resolve);}};},rpc:async()=>({error:null})};
 globalThis.__storeAudit={db,createPixOrder:async()=>{posts++;return {orderId:'ORD_fixture',amount:10,qrCode:null,qrCodeBase64:null,ticketUrl:null,dateOfExpiration:null};},getOrder:async()=>{gets++;return {id:'ORD_fixture',externalReference:'shop_fixture',amount:10,status:'action_required',statusDetail:'waiting_payment',raw:{transactions:{payments:[{payment_method:{qr_code:'fake-ready-qr'}}]}}};}};
 let source=await read('../src/lib/store-server.ts');
 source=source.replace('import "server-only";','')
  .replace('import { createAdminClient } from "@/lib/supabase/admin";','const createAdminClient=()=>globalThis.__storeAudit.db;')
  .replace('import { createClient } from "@/lib/supabase/server";','const createClient=async()=>globalThis.__storeAudit.db;')
  .replace('import { createPixOrder, getOrder, qrFrom, targetChargeStatus, type MpOrder } from "@/lib/mercadopago";','const {createPixOrder,getOrder}=globalThis.__storeAudit;const qrFrom=raw=>({qrCode:raw.transactions.payments[0].payment_method.qr_code});const targetChargeStatus=()=>null;')
  .replace('import { isStoreOrderOpen, type StoreOrder } from "@/lib/store";','const isStoreOrderOpen=o=>["creating","pending"].includes(o.payment_status);');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 const {ensureStorePix,syncStoreOrder}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
 try{
  await ensureStorePix(state);assert.equal(state.mp_order_id,'ORD_fixture');assert.equal(posts,1);assert.equal(gets,0);
  await ensureStorePix(state);await syncStoreOrder(state);assert.equal(posts,1);assert.equal(state.qr_code,'fake-ready-qr');
 }finally{delete globalThis.__storeAudit;}
});

test('Schema atual: migrations 0024–0028/0031, histórico, atendimento, estoque e permissões',async t=>{
 const db=new PGlite();const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
 const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',actor='11111111-1111-4111-8111-111111111111';
 const product='cccccccc-cccc-4ccc-8ccc-cccccccccccc',digital='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 const asOwner=()=>db.exec('reset role');
 const asCustomer=(id=a)=>db.exec(`set role authenticated;select set_config('test.customer','${id}',false);select set_config('test.admin','false',false);select set_config('test.actor','',false)`);
 const asAdmin=()=>db.exec(`set role authenticated;select set_config('test.admin','true',false);select set_config('test.readonly','false',false);select set_config('test.actor','${actor}',false)`);
 const service=()=>db.exec("reset role;set role service_role;select set_config('test.actor','',false)");
 const line=(id=product,mode='coins')=>({reward_id:id,quantity:1,mode,expected_cash:mode==='cash'?10:0,expected_coins:mode==='coins'?100:0});
 const checkout=async(items=[line()])=>scalar('select checkout_store_cart($1,$2::jsonb)',[crypto.randomUUID(),JSON.stringify(items)]);
 const handle=(id,status,note='fixture')=>db.query('select handle_store_order($1,$2,$3)',[id,status,note]);
 try{
  await db.exec(await read('./fixtures/store-baseline.sql'));
  await db.exec(await read('./fixtures/store-current.sql'));
  // Ajuste numérico real da migration 0022, necessário ao histórico de 0028.
  const tier=await read('../supabase/migrations/0022_loyalty_tiers_by_points.sql');
  await db.exec(tier.slice(tier.indexOf('create function public.adjust_loyalty_points('),tier.indexOf('revoke all on function public.get_customer_loyalty_earned_points',tier.indexOf('create function public.adjust_loyalty_points('))));
  for(const file of ['0024_store_cart_and_pix.sql','0025_store_catalog_admin.sql','0026_admin_order_history.sql','0027_store_dashboard.sql','0028_loyalty_history_and_client_store.sql','0031_store_reliability_and_fulfillment.sql'])await db.exec(await read('../supabase/migrations/'+file));
  await db.query('insert into auth.users values($1)',[actor]);
  await db.query('insert into customers(id,name,email,phone_e164) values($1,$3,$4,$5),($2,$3,$4,$5)',[a,b,'Fixture','fixture@example.invalid','+5500000000000']);
  await db.query("insert into loyalty_ledger(customer_id,points,kind,note) values($1,5000,'adjustment','fixture'),($2,5000,'adjustment','fixture')",[a,b]);
  await db.query("insert into loyalty_rewards(id,name,points_cost,cash_price,internal_cost,stock,active,delivery_kind) values($1,'Physical',100,10,3,20,true,'physical'),($2,'Digital',100,10,2,20,true,'digital')",[product,digital]);
  let order,shipment,lot;
  await t.test('custos históricos privados, snapshot físico e trilha de eventos somente leitura',async()=>{
   await asCustomer();order=await checkout();
   await assert.rejects(db.query('select unit_internal_cost from store_order_items'),/permission denied/);
   assert.equal(await scalar('select delivery_kind from store_order_items where order_id=$1',[order]),'physical');
   assert.equal(await scalar('select count(*)::int from store_order_events'),0);
   await assert.rejects(db.query('delete from store_order_events'),/permission denied/);
   await asAdmin();await assert.rejects(handle(order,'fulfilled'),/Produto físico/);
   await handle(order,'processing','primeira nota');await handle(order,'boxed','segunda nota');await handle(order,'boxed','repetição');
   const events=await db.query('select note from store_order_events where order_id=$1 order by id',[order]);
   assert.ok(events.rows.some(e=>e.note==='primeira nota'));assert.ok(events.rows.some(e=>e.note==='segunda nota'));assert.ok(!events.rows.some(e=>e.note==='repetição'));
   const history=await scalar('select get_admin_order_history()');assert.equal(history.items[0].physical,true);assert.ok(history.items[0].boxed_at);assert.ok(history.items[0].events.length>=3);
  });
  await t.test('benefício digital conclui diretamente, tipo histórico não muda com o catálogo',async()=>{
   await asCustomer();const id=await checkout([line(digital)]);await asOwner();await db.query("update loyalty_rewards set delivery_kind='physical' where id=$1",[digital]);
   await asAdmin();await handle(id,'fulfilled');assert.equal(await scalar('select fulfillment_status from store_orders where id=$1',[id]),'fulfilled');
  });
  await t.test('frete/lotes pendentes bloqueiam vínculo; pedido físico pronto acompanha pacote',async()=>{
   await asOwner();lot=crypto.randomUUID();shipment=crypto.randomUUID();
   await db.query("insert into lots(id,customer_id,status) values($1,$2,'paid')",[lot,a]);
   await db.query("insert into shipments(id,customer_id,batch_date) values($1,$2,current_date)",[shipment,a]);
   await db.query('insert into shipment_lots values($1,$2)',[shipment,lot]);
   await service();await db.exec("select set_config('test.freight_unpaid','true',false)");
   await assert.rejects(db.query('select bind_store_orders_to_shipment($1)',[shipment]),/pendente/);
   await db.exec("select set_config('test.freight_unpaid','false',false)");
   assert.equal(await scalar('select bind_store_orders_to_shipment($1)',[shipment]),1);
   assert.equal(await scalar('select bind_store_orders_to_shipment($1)',[shipment]),0);
   await asCustomer();const history=await scalar('select get_customer_order_history()');assert.ok(history.items.find(r=>r.id===order).shipment.code);
   await asCustomer(b);const other=await scalar('select get_customer_order_history()');assert.equal(other.total,0);
   await assert.rejects(db.query('select bind_store_orders_to_shipment($1)',[shipment]),/permission denied/);
  });
  await t.test('cancelamento de etiqueta libera vínculo e mantém a caixa; nova entrega conclui uma vez',async()=>{
   await asOwner();await db.query("update shipments set status='cancelled' where id=$1",[shipment]);
   assert.equal(await scalar('select shipment_id from store_orders where id=$1',[order]),null);
   assert.ok(await scalar('select boxed_at from store_orders where id=$1',[order]));
   const next=crypto.randomUUID();await db.query('insert into shipments(id,customer_id,batch_date) values($1,$2,current_date)',[next,a]);await db.query('insert into shipment_lots values($1,$2)',[next,lot]);
   await service();await db.query('select bind_store_orders_to_shipment($1)',[next]);
   await asOwner();await db.query("update shipments set status='delivered' where id=$1",[next]);await db.query("update shipments set status='delivered' where id=$1",[next]);
   assert.equal(await scalar('select fulfillment_status from store_orders where id=$1',[order]),'fulfilled');
  });
  await t.test('reconciliação restrita ao serviço, com lease e sem liberar recursos por vencimento local',async()=>{
   await asCustomer(b);const id=await checkout([line(product,'cash')]);
   await assert.rejects(db.query('select * from claim_store_reconciliation(3)'),/permission denied/);
   await service();let rows=await db.query('select * from claim_store_reconciliation(3)');assert.equal(rows.rows.length,1);assert.equal(rows.rows[0].id,id);
   rows=await db.query('select * from claim_store_reconciliation(3)');assert.equal(rows.rows.length,0);
   await asOwner();await db.query("update store_orders set expires_at=now()-interval '1 day' where id=$1",[id]);
   assert.equal(await scalar('select payment_status from store_orders where id=$1',[id]),'creating');
   await service();await db.query("select settle_store_payment($1,'ORD_fixture',10,'cancelled',null)",['shop_'+id]);
  });
  await t.test('pedido físico por Pix já postado e estornado não retorna ao estoque nem é concluído depois',async()=>{
   await asCustomer(b);const id=await checkout([line(product,'cash')]);
   await service();await db.query("select settle_store_payment($1,'ORD_posted',10,'paid',null)",['shop_'+id]);
   await asAdmin();await handle(id,'processing');await handle(id,'boxed');
   await asOwner();const packageId=crypto.randomUUID(),lotId=crypto.randomUUID();
   await db.query("insert into lots(id,customer_id,status) values($1,$2,'paid')",[lotId,b]);
   await db.query('insert into shipments(id,customer_id,batch_date) values($1,$2,current_date)',[packageId,b]);
   await db.query('insert into shipment_lots values($1,$2)',[packageId,lotId]);
   await service();await db.query('select bind_store_orders_to_shipment($1)',[packageId]);
   await asOwner();await db.query("update shipments set status='posted' where id=$1",[packageId]);
   const before=await scalar('select stock from loyalty_rewards where id=$1',[product]);
   await service();await db.query("select settle_store_payment($1,'ORD_posted',10,'refunded',null)",['shop_'+id]);
   await db.query("select settle_store_payment($1,'ORD_posted',10,'refunded',null)",['shop_'+id]);
   await asOwner();assert.equal(await scalar('select stock from loyalty_rewards where id=$1',[product]),before);
   await db.query("update shipments set status='delivered' where id=$1",[packageId]);
   assert.equal(await scalar('select fulfillment_status from store_orders where id=$1',[id]),'processing');
  });
  await t.test('ajuste fracionário idempotente e dashboard/históricos atuais',async()=>{
   await asAdmin();const key=crypto.randomUUID();
   await db.query("select adjust_caracoins_once($1,$2,0.5,'fixture ajuste')",[key,a]);await db.query("select adjust_caracoins_once($1,$2,0.5,'fixture ajuste')",[key,a]);
   await asOwner();assert.equal(await scalar('select count(*)::int from loyalty_manual_requests where id=$1',[key]),1);await asAdmin();
   const dashboard=await scalar('select get_store_dashboard()');assert.ok(dashboard.metrics.orders>=2);
   const history=await scalar('select get_caracoins_history()');assert.ok(history.total>0);
   await asCustomer(b);await assert.rejects(db.query('select get_admin_order_history()'),/Acesso negado/);await assert.rejects(db.query('select get_store_dashboard()'),/Acesso negado/);
   const catalog=await scalar('select get_customer_store_catalog()');assert.ok(catalog.total>=2);
  });
 }finally{await db.close();}
});
