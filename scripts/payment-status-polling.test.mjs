import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as zod from 'zod';

function fixture(){
 let loggedIn=true;const queries=[];
 const db={from(table){const query={table};queries.push(query);return {
  select(columns){query.columns=columns;return this;},
  eq(column,value){query.filter=[column,value];return this;},
  async in(column,ids){query.ids=ids;assert.equal(column,'id');assert.deepEqual(query.filter,['customer_id','owner-customer']);return {data:[{id:ids[0],status:'paid',qr_code:'private-pix-data',expires_at:null}],error:null};},
 };}};
 const deps={zod,'@/lib/dal':{requireCustomer:async()=>{if(!loggedIn)throw Error('no session');return {customer:{id:'owner-customer'}};}},'@/lib/supabase/server':{createClient:async()=>db},'@/lib/result':{rethrowIfRedirect(){}}};
 const api={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/app/actions/payment-status.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:api,require:n=>{assert.ok(n in deps,`Unexpected dependency: ${n}`);return deps[n];}});
 return {api,queries,logout(){loggedIn=false;}};
}
const id='11111111-1111-4111-8111-111111111111';
test('leitura de status limita resultados ao dono e não devolve QR ou contatos',async()=>{
 const {api,queries}=fixture();
 for(const [kind,table] of [['auction','charges'],['store','store_orders'],['raffle','raffle_orders']]){
  const result=await api.readSelfPaymentStates(kind,[id,id]);
  assert.equal(result.ok,true);assert.equal(queries.at(-1).table,table);assert.equal(queries.at(-1).ids.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)),[{id,status:'paid',hasQr:true,expiresAt:null}]);
 }
});
test('sessão ausente, IDs inválidos e listas grandes não chegam à consulta',async()=>{
 const f=fixture();
 assert.equal((await f.api.readSelfPaymentStates('auction',['not-an-id'])).ok,false);
 assert.equal((await f.api.readSelfPaymentStates('customers',[id])).ok,false);
 assert.equal((await f.api.readSelfPaymentStates('raffle',Array(21).fill(id))).ok,false);
 f.logout();assert.equal((await f.api.readSelfPaymentStates('store',[id])).ok,false);
 assert.equal(f.queries.length,0);
});
