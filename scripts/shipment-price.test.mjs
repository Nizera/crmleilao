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
  '@/lib/superfrete':{getOrderInfo:async()=>{consulted++;return {id:'remote',price:'25.50'};},fallbackTrackingUrl:()=>null},
  '@/lib/shipment-price':exports,
 }[n]??{})});
 const result=await api.applySuperfreteEvent({sfOrderId:'remote',event:'order.posted',data:{price:1}});
 assert.equal(result.ok,true);assert.equal(consulted,1);assert.equal(patch.price,25.5);assert.equal(patch.price_observation_source,'api');assert.ok(patch.price_checked_at);
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
