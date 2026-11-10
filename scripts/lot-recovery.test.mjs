import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';

function fixture({role='admin',status='cancelled',expired=true,paid=false,charge=null,race=false}={}) {
 const lot={id:'lot',code:'TEST',status,payment_expired_at:expired?'2026-11-08T00:00:00Z':null,paid_at:paid?'paid':null,shipped_at:null,charge_id:charge};
 let writes=0,guards=0;
 const db={from(table){const filters=[];let patch;
  const execute=()=>{if(table==='lot_items')return {data:[],error:null};if(race&&patch)lot.status='paid';const matches=filters.every(([k,v])=>lot[k]===v);if(patch&&matches){writes++;Object.assign(lot,patch);}return {data:matches?[lot]:[],error:null};};
  return {select(){return this},eq(k,v){filters.push([k,v]);return this},is(k,v){filters.push([k,v]);return this},update(v){patch=v;return this},maybeSingle:async()=>({data:lot,error:null}),then(resolve){return Promise.resolve(execute()).then(resolve)}};
 }};
 const exports={};const deps={'next/cache':{revalidatePath(){},updateTag(){}},zod:{z},'@/lib/dal':{requireAdmin:async()=>({profile:{role}})},'@/lib/lots':{LOT_STATUSES:['pending_payment','paid','shipped','delivered','cancelled']},'@/lib/supabase/server':{createClient:async()=>db},'@/lib/result':{rethrowIfRedirect(){}},'@/lib/lot-payment-guard':{prepareLotFinancialChange:async()=>{guards++;}}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/app/actions/lots.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,console,require:name=>deps[name]??{}});
 return {api:exports,lot,writes:()=>writes,guards:()=>guards};
}
test('recuperação exige equipe com permissão de escrita',async()=>{
 const f=fixture({role:'viewer'});assert.equal((await f.api.recoverExpiredLotAction('lot')).ok,false);assert.equal(f.writes(),0);
});
test('recupera somente lote expirado sem cobrança, pagamento ou envio',async()=>{
 for(const options of [{expired:false},{status:'paid',paid:true},{charge:'old-pix'},{status:'pending_payment'}]){const f=fixture(options);assert.equal((await f.api.recoverExpiredLotAction('lot')).ok,false);assert.equal(f.writes(),0);}
 const f=fixture();assert.equal((await f.api.recoverExpiredLotAction('lot')).ok,true);assert.equal(f.lot.status,'pending_payment');assert.equal(f.lot.charge_id,null);assert.equal(f.lot.paid_at,null);assert.equal(f.lot.pix_paused_at,null);assert.equal(f.guards(),1);assert.equal(f.writes(),1);
});
test('pagamento concorrente impede recuperação de uma tela desatualizada',async()=>{
 const f=fixture({race:true});assert.equal((await f.api.recoverExpiredLotAction('lot')).ok,false);assert.equal(f.lot.status,'paid');assert.equal(f.writes(),0);
});
