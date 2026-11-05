import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/shipment-price.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});
test('preço aceita reais válidos e ignora campo ausente, vazio, negativo ou malformado',()=>{
 for(const value of [null,undefined,'',true,{},NaN,Infinity,-1,'1,20','1.234'])assert.equal(exports.observedShipmentPrice(value),null);
 for(const value of [0,18.2,'18.20'])assert.equal(exports.observedShipmentPrice(value),Number(value));
});
test('webhook consulta preço atual autenticado e ignora preço antigo do evento',async()=>{
 const shipment={id:'fixture',sf_order_id:'remote',status:'posted',price:20,events:[]};let patch,consulted=0;
 const db={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:shipment,error:null})})}),update:value=>({eq:async()=>{patch=value;return {error:null};}})})};
 const code=ts.transpileModule(fs.readFileSync('src/lib/shipments-server.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const api={};vm.runInNewContext(code,{exports:api,Date,console,require:n=>({
  '@/lib/supabase/admin':{createAdminClient:()=>db},
  '@/lib/superfrete':{getOrderInfo:async()=>{consulted++;return {id:'remote',price:'25.50',service_posted:{total_with_discount:'37.78'}};},fallbackTrackingUrl:()=>null},
  '@/lib/shipment-price':exports,
 }[n]??{})});
 const result=await api.applySuperfreteEvent({sfOrderId:'remote',event:'order.posted',data:{price:1}});
 assert.equal(result.ok,true);assert.equal(consulted,1);assert.equal(patch.price,37.78);assert.equal(patch.price_observation_source,'api');assert.ok(patch.price_checked_at);
});
test('histórico: baseline real/legado, idempotência, retorno ao original e proteção de acesso',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create function public.is_admin() returns boolean language sql as $$select current_setting('test.admin',true)='true'$$;
 create table public.customers(id uuid primary key,name text,phone_e164 text);
 create table public.shipments(id uuid primary key default gen_random_uuid(),price numeric(10,2),customer_id uuid,code text default 'E-TEST',sf_order_id text default 'remote',tracking_code text,status text default 'released',batch_date date);
 grant select on public.shipments,public.customers to authenticated;
 insert into public.shipments(price) values(18);`);
 const migration=fs.readFileSync('supabase/migrations/0057_shipment_price_history.sql','utf8');await db.exec(migration);
 const old=(await db.query('select * from shipments')).rows[0];assert.equal(old.price_baseline_legacy,true);assert.equal(Number(old.original_price),18);
 const id=(await db.query('insert into shipments(price) values(20) returning id')).rows[0].id;
 assert.equal((await db.query('select price_baseline_legacy from shipments where id=$1',[id])).rows[0].price_baseline_legacy,false);
 await Promise.all([db.query("update shipments set price=25,price_observation_source='api' where id=$1",[id]),db.query("update shipments set price=25,price_observation_source='api' where id=$1",[id])]);
 assert.equal((await db.query('select count(*)::int n from shipment_price_history')).rows[0].n,1);
 await db.query('update shipments set price=20,original_price=999,price_change_count=99 where id=$1',[id]);
 const current=(await db.query('select * from shipments where id=$1',[id])).rows[0];assert.equal(Number(current.original_price),20);assert.equal(Number(current.price_difference),0);assert.equal(current.price_change_count,2);
 await db.exec("select set_config('test.admin','true',false);insert into shipments(price,batch_date) select 10,'2026-11-03'::date from generate_series(1,30);insert into shipments(price,batch_date,status) values(100,'2026-11-03','cancelled')");
 const summary=(await db.query("select get_shipment_cost_summary('2026-11-03','','all','all') s")).rows[0].s;
 assert.equal(summary.labels,30);assert.equal(summary.cancelled,1);assert.equal(Number(summary.emissionTotal),300);
 await db.query("update shipments set tracking_code='AA123456789BR' where id=$1",[id]);
 const byTracking=(await db.query("select get_shipment_cost_summary(null,'AA123456789BR','all','changed') s")).rows[0].s;assert.equal(byTracking.labels,1);assert.equal(Number(byTracking.emissionTotal),20);
 await db.exec("set role authenticated;select set_config('test.admin','false',false)");assert.equal((await db.query('select * from shipment_price_history')).rows.length,0);
 assert.equal((await db.query("select get_shipment_cost_summary() s")).rows[0].s.labels,0);
 await db.exec("select set_config('test.admin','true',false)");assert.equal((await db.query('select * from shipment_price_history')).rows.length,2);
 await assert.rejects(db.query('delete from shipment_price_history'),/permission denied/);
 await db.exec('reset role');await db.exec(migration);assert.equal((await db.query('select count(*)::int n from shipment_price_history')).rows[0].n,2);
 }finally{await db.close();}
});


test('aferição real da postagem tem prioridade sobre o valor original da API',()=>{
 assert.equal(exports.superfreteOrderPrice({price:31.73,service_posted:{total_with_discount:37.78}}),37.78);
 assert.equal(exports.superfreteOrderPrice({price:25.36,service_posted:{total_with_discount:'23.85'}}),23.85);
 for(const posted of [null,{},[],{total_with_discount:0},{total_with_discount:-1},{total_with_discount:'37,78'}]) assert.equal(exports.superfreteOrderPrice({price:31.73,service_posted:posted}),31.73);
 assert.equal(exports.superfreteOrderPrice({price:31.73,service_posted:{total_without_discount:45.5},discount:9.27}),31.73);
 assert.equal(exports.superfreteOrderPrice({price:31.73},37.78,31.73),37.78);
 assert.equal(exports.superfreteOrderPrice({price:31.73,service_posted:{total_with_discount:31.73}},37.78,31.73),31.73);
 assert.equal(exports.superfreteOrderPrice(null),null);
});

test('histórico paginado volta a uma página válida após reduzir os resultados',async()=>{
 const source=fs.readFileSync('src/lib/dal.ts','utf8');const start=source.indexOf('export async function listShipments(');const end=source.indexOf('/**',start+10);
 for(const outOfRangeError of [false,true]){
  const calls=[];let from=0;let ran=0;
  const query={select(){return this;},order(){return this;},range(a,b){from=a;calls.push(['range',a,b]);return this;},gt(k,v){calls.push(['gt',k,v]);return this;},lt(){return this;},eq(k,v){calls.push(['eq',k,v]);return this;},then(resolve){ran++;return Promise.resolve(from>0?{data:[],count:outOfRangeError?null:1,error:outOfRangeError?{code:'PGRST103'}:null}:{data:[{id:'AP685604329BR'}],count:1,error:null}).then(resolve);}};
  const api={};vm.runInNewContext(ts.transpileModule(source.slice(start,end),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:api,createClient:async()=>({from:()=>query}),SHIPMENT_COLUMNS:'id',attachLots:async rows=>rows});
  const result=await api.listShipments({page:2,priceChanges:'changed',batchDate:'2026-11-03'});
  assert.equal(result.page,1);assert.equal(result.rows[0].id,'AP685604329BR');assert.equal(result.total,1);assert.equal(ran,2);
  assert.ok(calls.some(c=>c[0]==='gt'&&c[1]==='price_change_count'&&c[2]===0));
  assert.ok(calls.some(c=>c[0]==='eq'&&c[1]==='batch_date'&&c[2]==='2026-11-03'));
 }
});


test('conciliação diária limita escopo, ignora cancelados e isola falha de provedor',async()=>{
 const source=fs.readFileSync('src/lib/shipments-server.ts','utf8');const start=source.indexOf('export async function reconcileShipmentCosts(');const end=source.indexOf('export async function syncShipment(',start);
 let configured=true;const filters=[];const changed=[];const requested=[];
 const query={select(){return this;},in(k,v){filters.push([k,...v]);return this;},gte(k,v){filters.push([k,v]);return this;},or(v){filters.push(['or',v]);return this;},order(){return this;},limit(n){filters.push(['limit',n]);return Promise.resolve({data:[{id:'ok'},{id:'fail'},{id:'cancelled'}],error:null});}};
 const api={};vm.runInNewContext(ts.transpileModule(source.slice(start,end),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:api,Date,sfConfigured:()=>configured,createAdminClient:()=>({from:()=>query}),getShipmentById:async id=>({id,status:id==='cancelled'?'cancelled':'posted',sf_order_id:id}),getOrderInfo:async(id,timeout)=>{requested.push(id);assert.ok(timeout>0&&timeout<=8000);if(id==='fail')throw Error('provedor indisponível');return {id,price:31.73,service_posted:{total_with_discount:37.78}};},applyOrderInfo:async(s,info)=>changed.push([s.id,info.service_posted.total_with_discount])});
 assert.deepEqual(JSON.parse(JSON.stringify(await api.reconcileShipmentCosts(10000))),{checked:1,failed:1});
 assert.deepEqual(changed,[['ok',37.78]]);assert.ok(!requested.includes('cancelled'));
 assert.ok(filters.some(x=>x[0]==='status'&&x[1]==='posted'&&x[2]==='delivered'));
 assert.ok(filters.some(x=>x[0]==='limit'&&x[1]===60));
 configured=false;assert.equal((await api.reconcileShipmentCosts()).checked,0);
 configured=true;assert.equal((await api.reconcileShipmentCosts(0)).checked,0);
});

test('consulta SuperFrete valida identidade da etiqueta e impõe timeout',async()=>{
 let remoteId='outra-etiqueta',signal;
 const api={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/superfrete.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:api,AbortSignal,URL,process:{env:{SUPERFRETE_TOKEN:'fixture-only',SUPERFRETE_SANDBOX:'false'}},require:()=>({}),fetch:async(url,options)=>{signal=options.signal;return {ok:true,json:async()=>({id:remoteId,price:31.73})};}});
 await assert.rejects(api.getOrderInfo('etiqueta-certa',500),/dados do pedido/);
 remoteId='etiqueta-certa';assert.equal((await api.getOrderInfo(remoteId,500)).id,remoteId);assert.ok(signal instanceof AbortSignal);
});
