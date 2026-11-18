import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import ts from 'typescript';
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const moduleOf=code=>import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const rules=await moduleOf(compile(await readFile(new URL('../src/lib/meta-commerce.ts',import.meta.url),'utf8')));

test('tracking rules: store only, real identifiers and money without freight',()=>{
 assert.equal(rules.isStoreMarketingPath('/loja'),true);assert.equal(rules.isStoreMarketingPath('/painel/loja'),true);
 for(const p of ['/painel/rifas','/admin','/painel/pix','/loja/falso'])assert.equal(rules.isStoreMarketingPath(p),false);
 assert.equal(rules.storeRevenue(110,20),90);assert.equal(rules.storeRevenue(20,20),0);assert.equal(rules.storeRevenue(.3,.1),.2);
 assert.equal(rules.cleanMetaId('arbitrary'),null);assert.equal(rules.cleanMetaId('fb.1.1763424000000.click_123'),'fb.1.1763424000000.click_123');
 assert.deepEqual(rules.cleanAttribution({utm_source:'instagram',utm_campaign:'Legends 2026',email:'x@y.com',utm_content:'a@b.com'}),{utm_source:'instagram',utm_campaign:'Legends 2026'});
});

test('browser: no pixel before consent, store scope, refusal and no synthetic purchases',async()=>{
 const saved={window:globalThis.window,document:globalThis.document,location:globalThis.location,localStorage:globalThis.localStorage};
 const storage=new Map(),scripts=[],calls=[];
 globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
 globalThis.location={pathname:'/loja',search:'',hostname:'shop.invalid'};
 globalThis.window={dispatchEvent:()=>{},addEventListener:()=>{},removeEventListener:()=>{}};
 globalThis.document={createElement:()=>({}),head:{appendChild:s=>scripts.push(s)},cookie:''};
 try{
  const rulesCode=compile(await readFile(new URL('../src/lib/meta-commerce.ts',import.meta.url),'utf8'));
  let browser=compile(await readFile(new URL('../src/lib/meta-browser.ts',import.meta.url),'utf8'));
  browser=browser.replace(/from ['"]@\/lib\/meta-commerce['"]/,`from 'data:text/javascript;base64,${Buffer.from(rulesCode).toString('base64')}'`);
  const m=await moduleOf(browser);m.enableStorePixel('1074294225103386');assert.equal(scripts.length,0);
  m.writeMarketingChoice(true);m.enableStorePixel('1074294225103386');assert.equal(scripts.length,1);
  assert.equal(window.fbq.disablePushState,true);
  window.fbq.callMethod=(...args)=>calls.push(args);
  m.trackStoreProduct('AddToCart',{id:'product',cash_price:45,points_cost:null});assert.equal(calls.at(-1)[2],'AddToCart');assert.equal(calls.at(-1)[3].value,45);
  m.trackStoreEvent('PageView');m.trackStoreEvent('PageView');
  m.enableStorePixel('1074294225103386');m.trackStoreEvent('PageView');
  assert.equal(calls.filter(x=>x[2]==='PageView').length,1);
  location.pathname='/rifas';m.leaveStoreMarketing();location.pathname='/loja';m.enableStorePixel('1074294225103386');m.trackStoreEvent('PageView');
  assert.equal(calls.filter(x=>x[2]==='PageView').length,2); // A real return to the store is a new visit.
  m.trackStoreEvent('InitiateCheckout',{value:45},'checkout-one');m.trackStoreEvent('InitiateCheckout',{value:45},'checkout-one');
  assert.equal(calls.filter(x=>x[2]==='InitiateCheckout').length,1);
  m.trackStoreEvent('InitiateCheckout',{value:50},'checkout-two');
  assert.equal(calls.filter(x=>x[2]==='InitiateCheckout').length,2);
  const n=calls.length;location.pathname='/painel/rifas';m.trackStoreEvent('PageView');assert.equal(calls.length,n);
  location.pathname='/loja';m.writeMarketingChoice(false);m.trackStoreEvent('PageView');assert.equal(calls.length,n);
  assert.ok(!calls.some(x=>x.includes('Purchase')));
 }finally{for(const [k,v] of Object.entries(saved)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
});

test('PostgreSQL: paid-only queue, discount, consent, replay, leases and private data',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create table store_orders(id uuid primary key,customer_id uuid not null,created_at timestamptz default now(),paid_at timestamptz,payment_status text default 'pending',cash_total numeric,freight_amount numeric default 0,coins_total numeric default 0);
   create table store_order_items(id uuid primary key default gen_random_uuid(),order_id uuid,reward_id uuid,quantity int,unit_cash numeric);`);
  await db.exec(await readFile(new URL('../supabase/migrations/0095_store_meta_conversions.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/0096_meta_retry_dedup_window.sql',import.meta.url),'utf8'));
  const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
  const customer=crypto.randomUUID(),session=crypto.randomUUID();
  await db.query("insert into store_marketing_sessions(id,consent,consent_version) values($1,true,'test')",[session]);
  async function order({cash=110,freight=20,coins=0,consent=true,old=false,paid=false}={}){
   const id=crypto.randomUUID();
   await db.query("insert into store_orders(id,customer_id,cash_total,freight_amount,coins_total,created_at,payment_status) values($1,$2,$3,$4,$5,now()-($6::int*interval '1 hour'),$7)",[id,customer,cash,freight,coins,old?2:0,paid?'paid':'pending']);
   await db.query('insert into store_order_items(order_id,reward_id,quantity,unit_cash) values($1,$2,1,100)',[id,crypto.randomUUID()]);
   if(consent)await db.query('select attach_store_marketing($1,$2,$3)',[id,customer,session]);
   return id;
  }
  const id=await order();assert.equal(await scalar('select count(*)::int from store_meta_events'),0);
  await db.query("update store_orders set payment_status='paid',paid_at=now() where id=$1",[id]);
  await db.query("update store_orders set payment_status='paid' where id=$1",[id]);
  await db.query('select attach_store_marketing($1,$2,$3)',[id,customer,session]);
  assert.equal(await scalar('select count(*)::int from store_meta_events'),1);
  assert.equal(await scalar("select (payload->>'value')::numeric from store_meta_events"),'90');
  for(const options of [{cash:20},{cash:0,freight:0},{coins:100},{consent:false},{old:true}]){
   const other=await order(options);await db.query("update store_orders set payment_status='paid' where id=$1",[other]);
  }
  assert.equal(await scalar('select count(*)::int from store_meta_events'),1);
  const first=(await db.query('select * from claim_store_meta_events(5)')).rows;
  assert.equal(first.length,1);assert.ok(first[0].lease_token);assert.equal(first[0].attempts,1);
  assert.equal((await db.query('select * from claim_store_meta_events(5)')).rows.length,0);
  await db.exec("update store_marketing_sessions set consent=false");
  await db.query('select * from claim_store_meta_events(5)');
  assert.equal(await scalar('select status from store_meta_events'),'skipped');
  await db.exec("update store_marketing_sessions set consent=true");
  const freePaid=await order({paid:true}); // Already-paid checkout can enqueue only after items + consent exist.
  assert.equal(await scalar('select count(*)::int from store_meta_events'),2);
  await db.query("update store_orders set payment_status='refunded' where id=$1",[freePaid]);
  assert.equal((await db.query('select * from claim_store_meta_events(5)')).rows.length,0);
  const aged=await order({paid:true});
  await db.query("update store_meta_events set event_time=now()-interval '37 hours' where order_id=$1",[aged]);
  assert.equal((await db.query('select * from claim_store_meta_events(5)')).rows.length,0);
  assert.equal(await scalar('select status from store_meta_events where order_id=$1',[aged]),'failed');
  assert.equal(await scalar('select event_id from store_meta_events where order_id=$1',[aged]),'store_purchase_'+aged);
  await db.exec('set role authenticated');
  await assert.rejects(db.exec('select * from store_marketing_sessions'),/permission denied/);
  await assert.rejects(db.query('select enqueue_store_meta_purchase($1)',[id]),/permission denied/);
 }finally{await db.close();}
});

test('CAPI: confirmed order, stable ID, hashed contact, secret header and retry',async()=>{
 const originalFetch=globalThis.fetch,oldEnv={...process.env};
 const updates=[],event={id:crypto.randomUUID(),order_id:crypto.randomUUID(),lease_token:crypto.randomUUID(),event_id:'store_purchase_test',event_time:new Date().toISOString(),payload:{value:90,currency:'BRL'},attempts:1};
 let consent=true,status='paid';
 const db={rpc:async()=>({data:[event]}),from(table){let update;const b={select(){return b;},eq(){return b;},update(v){update=v;updates.push(v);return b;},single:async()=>({data:table==='store_order_attribution'?{session_id:'session'}:table==='store_marketing_sessions'?{consent,expires_at:new Date(Date.now()+60000).toISOString(),source_url:'https://shop.invalid/loja',user_agent:'test-browser',fbp:'fb.1.1234567890.123'}:table==='store_orders'?{payment_status:status,customer_id:'customer-id'}:{email:' BUYER@example.invalid ',phone_e164:'+5511999999999'}}),then(resolve){resolve({error:null});}};return b;}};
 globalThis.__metaTestDb=db;
 try{
  process.env.VERCEL_ENV='production';process.env.META_PIXEL_ID='1074294225103386';process.env.META_CONVERSIONS_ACCESS_TOKEN='test-token';delete process.env.META_TEST_EVENT_CODE;
  let code=compile(await readFile(new URL('../src/lib/meta-conversions-server.ts',import.meta.url),'utf8'));
  code=code.replace(/import ['"]server-only['"];?/,'').replace(/import \{ cookies \} from ['"]next\/headers['"];?/,"const cookies=async()=>({get:()=>null});").replace(/import \{ createAdminClient \} from ['"]@\/lib\/supabase\/admin['"];?/,"const createAdminClient=()=>globalThis.__metaTestDb;").replace(/import \{ MARKETING_COOKIE \} from ['"]@\/lib\/meta-commerce['"];?/,"const MARKETING_COOKIE='test';");
  const {flushMetaConversions}=await moduleOf(code);
  let calls=0;
  globalThis.fetch=async(url,options)=>{calls++;assert.equal(new URL(url).search,'');assert.equal(options.headers.Authorization,'Bearer test-token');const body=JSON.parse(options.body),p=body.data[0];assert.equal(p.event_id,event.event_id);assert.equal(p.custom_data.value,90);assert.match(p.user_data.em[0],/^[a-f0-9]{64}$/);assert.ok(!options.body.includes('BUYER'));assert.equal(p.action_source,'website');return Response.json({events_received:1,fbtrace_id:'test-trace'});};
  assert.equal((await flushMetaConversions()).sent,1);assert.equal(updates.at(-1).status,'sent');
  consent=false;assert.equal((await flushMetaConversions()).sent,0);assert.equal(calls,1);assert.equal(updates.at(-1).status,'skipped');
  consent=true;status='refunded';await flushMetaConversions();assert.equal(calls,1);
  status='paid';globalThis.fetch=async()=>Response.json({error:{code:190}},{status:400});assert.equal((await flushMetaConversions()).failed,1);assert.equal(updates.at(-1).error_code,'meta_190');assert.equal(updates.at(-1).status,'pending');
 }finally{globalThis.fetch=originalFetch;delete globalThis.__metaTestDb;for(const key of ['VERCEL_ENV','META_PIXEL_ID','META_CONVERSIONS_ACCESS_TOKEN','META_TEST_EVENT_CODE']){if(oldEnv[key]===undefined)delete process.env[key];else process.env[key]=oldEnv[key];}}
});
