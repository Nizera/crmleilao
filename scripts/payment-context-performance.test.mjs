import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {createRequire} from "node:module";
import ts from "typescript";
const native=createRequire(import.meta.url);
function load(path,mocks={}) {
 const module={exports:{}};
 const js=ts.transpileModule(fs.readFileSync(path,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const requireMock=name=>Object.hasOwn(mocks,name)?mocks[name]:name==="server-only"?{}:name.startsWith("@/")?{}:native(name);
 vm.runInNewContext(js,{exports:module.exports,module,require:requireMock,console,Date,crypto:globalThis.crypto});
 return module.exports;
}
const core=load("src/lib/charges.ts",{"@/lib/lots":{},"@/lib/settings":{}});
const deadlines=load("src/lib/auction-deadlines.ts");
const past="2000-01-01T00:00:00Z",future="2099-01-01T00:00:00Z";
function database({charges=[],lots=[],due=[],failure=null,hold=false}={}) {
 const calls=[],started=new Set(),releases=[];
 const read=async(key,value)=>{
  started.add(key);
  if(hold)await new Promise(resolve=>releases.push(resolve));
  return failure===key?{data:null,error:{message:"offline"}}:{data:value,error:null};
 };
 return {
  calls,started,release:()=>releases.splice(0).forEach(resolve=>resolve()),
  from(table){
   const call={table};calls.push(call);
   const builder={
    select(columns){call.columns=columns;return this;},
    eq(key,value){call[key]=value;return this;},
    in(key,value){call.filter={key,value};return this;},
    order(key,opts){call.order={key,opts};return this;},
    limit(n){call.limit=n;return this;},
    single(){return read(table,{email:"client@example.com",cpf_cnpj:null});},
    then(resolve,reject){return read(table,table==="charges"?charges:lots).then(resolve,reject);}
   };
   return builder;
  },
  rpc(name,args){calls.push({rpc:name,args});return read("freight",due);}
 };
}
function server(db){
 return load("src/lib/charges-server.ts",{
  "@/lib/charges":core,"@/lib/auction-deadlines":deadlines,
  "@/lib/supabase/admin":{createAdminClient:()=>db}
 });
}

test("Active lookup reads only charge identity; pending Pix remains active after local expiry",async()=>{
 const db=database({charges:[{id:"active",status:"pending",expires_at:past}]});
 assert.equal(await server(db).findActiveChargeId("customer"),"active");
 assert.equal(db.calls.length,1);
 assert.equal(db.calls[0].columns,"id, status, expires_at");
 assert.equal(db.calls[0].customer_id,"customer");
 assert.equal(db.calls[0].limit,10);
 assert.deepEqual(Array.from(db.calls[0].filter.value),["pending","in_process"]);
 for(const status of ["pending","in_process"]){
  assert.equal(await server(database({charges:[{id:status,status,expires_at:null}]})).findActiveChargeId("customer"),status);
 }
 assert.equal(await server(database()).findActiveChargeId("customer"),null);
 await assert.rejects(server(database({failure:"charges"})).findActiveChargeId("customer"),/carregar cobranças/);
});

test("Admin context starts all independent reads before any completes and preserves lot eligibility and freight",async()=>{
 const db=database({hold:true,charges:[{id:"active",status:"pending",expires_at:past}],due:[{freight_amount:20}],lots:[
  {id:"eligible",code:"A",title:"Lote",arremate_value:60,discount_amount:10,status:"pending_payment",auction_date:"2026-11-23",payment_due_at:future,charge_id:null,charge:null},
  {id:"expired",payment_due_at:past,charge:null},
  {id:"already_reserved",payment_due_at:future,charge:{status:"in_process",expires_at:past}},
  {id:"old_cancelled",payment_due_at:future,charge:{status:"cancelled",expires_at:past}}
 ]});
 const pending=server(db).getChargeContext("customer");
 await new Promise(setImmediate);
 assert.deepEqual([...db.started].sort(),["charges","freight","lots"]);
 db.release();
 const result=await pending;
 assert.equal(result.activeCharge.id,"active");
 assert.deepEqual(Array.from(result.eligibleLots,x=>x.id),["eligible","old_cancelled"]);
 assert.equal(result.eligibleLots[0].discount_amount,10);
 assert.equal(result.freightAmount,20);assert.equal(result.freightDue,true);
 const empty=await server(database()).getChargeContext("customer");
 assert.equal(empty.activeCharge,null);assert.equal(empty.eligibleLots.length,0);
 assert.equal(empty.freightAmount,0);assert.equal(empty.freightDue,false);
});

test("Failed admin reads do not become an empty cart or free freight",async()=>{
 for(const failure of ["charges","lots","freight"])
  await assert.rejects(server(database({failure})).getChargeContext("customer"));
});

function selfAction(db,{existing=null,authFailure=false}={}){
 const writes=[];
 const real=server(db);
 const actions=load("src/app/actions/charges.ts",{
  "next/cache":{revalidatePath:()=>{},updateTag:()=>{}},
  "@/lib/charges":core,
  "@/lib/brazilian-document":{isValidBrazilianDocument:()=>true},
  "@/lib/result":{rethrowIfRedirect:()=>{}},
  "@/lib/dal":{requireCustomer:async()=>{if(authFailure)throw Error("no session");return {customer:{id:"customer"}};}},
  "@/lib/supabase/admin":{createAdminClient:()=>db},
  "@/lib/charges-server":{
   ...real,
   getChargeContext:async()=>{throw Error("Self-service should not load the full context twice");},
   getChargeById:async id=>{assert.equal(id,existing?.id);return existing;},
   createCharge:async input=>{writes.push(input);return {id:"new"};}
  }
 });
 return {actions,writes};
}
test("Self-service returns existing Pix without querying eligible lots/freight or creating another payment",async()=>{
 const existing={id:"active",status:"pending",expires_at:past};
 const db=database({charges:[existing]});const {actions,writes}=selfAction(db,{existing});
 const result=await actions.createSelfChargeAction();
 assert.equal(result.ok,true);assert.equal(result.data.charge.id,"active");
 assert.equal(writes.length,0);
 assert.deepEqual(db.calls.map(c=>c.table),["customers","charges"]);
});

test("New self-service Pix still delegates authoritative validation to createCharge; read/auth failures never create payments",async()=>{
 const db=database();const {actions,writes}=selfAction(db);
 const result=await actions.createSelfChargeAction(false);
 assert.equal(result.ok,true);assert.equal(writes.length,1);
 assert.equal(writes[0].customerId,"customer");
 assert.equal(writes[0].includeAllEligibleLots,true);
 assert.equal(writes[0].includeFreight,false);
 assert.equal(writes[0].createdBy,null);
 for(const options of [{db:database({failure:"charges"})},{db:database(),authFailure:true}]){
  const attempt=selfAction(options.db,options);
  assert.equal((await attempt.actions.createSelfChargeAction()).ok,false);
  assert.equal(attempt.writes.length,0);
 }
});
