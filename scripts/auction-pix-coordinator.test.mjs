import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function fixture({failure=false,terminal=false,concurrentPaid=false}={}){
 const charge={id:'charge',customer_id:'customer',code:'C-TEST',status:'pending',amount:10,external_reference:'stable-reference',mp_payment_id:null,pix_issue_since:null};
 const lot={id:'lot',status:'pending_payment',charge_id:'charge'};const attempts=[];let leased=false,resolved=0;
 const db={from(table){let patch=null;const filters=[];const row=()=>table==='charges'?charge:table==='lots'?lot:{name:'Fixture',email:'fixture@example.invalid',cpf_cnpj:null};
  const execute=()=>{const r=row();const matches=filters.every(([k,values])=>values.includes(r[k]));if(matches&&patch)Object.assign(r,patch);return {data:matches?[{...r}]:[],error:null};};
  return {select(){return this},update(p){patch=p;return this},eq(k,v){filters.push([k,[v]]);return this},in(k,v){filters.push([k,v]);return this},or(){return this},single:async()=>({data:{...row()},error:null}),maybeSingle:async()=>({data:{...row()},error:null}),then(resolve){return Promise.resolve(execute()).then(resolve)}};
 },async rpc(name,args){
  if(name==='claim_charge_pix_attempt'){if(leased)return {data:false};leased=true;return {data:true};}
  if(name==='record_charge_pix_issue'){charge.pix_issue_since??='start';charge.pix_issue_code=args.p_code;return {error:null};}
  if(name==='resolve_charge_pix_issue'){resolved++;charge.pix_issue_since=null;return {error:null};}
  throw Error(name);
 }};
 const deps={'server-only':{},'@/lib/auction-deadlines':{auctionDeadlineExpired:()=>false},'@/lib/charges':{isChargeOpen:s=>['pending','in_process'].includes(s)},'@/lib/supabase/admin':{createAdminClient:()=>db},'@/lib/lots':{formatBRL:String},'@/lib/notifications-server':{notifyCustomer:async()=>{}},'@/lib/mercadopago':{
  async createPixOrder(input){attempts.push(input);if(failure)throw Object.assign(new Error('provider failure'),{httpStatus:402,codes:['failed']});if(concurrentPaid){charge.status='approved';lot.status='paid';}return {orderId:'ORD_same',status:terminal?'failed':'action_required',statusDetail:terminal?'rejected':'waiting_transfer',amount:10,qrCode:terminal?null:'fixture-qr',qrCodeBase64:null,ticketUrl:null,dateOfExpiration:null};},targetChargeStatus:s=>s==='failed'?'rejected':null
 }};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/charges-server.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,console:{error(){},warn(){}},require:name=>deps[name]});
 return {api:exports,charge,lot,attempts,clearLease:()=>{leased=false},resolved:()=>resolved};
}

test('falha ambígua preserva vínculo, pausa prazo e repete a mesma referência sem concorrência',async()=>{
 const f=fixture({failure:true});await f.api.recoverChargeOrder('charge');assert.equal(f.charge.status,'pending');assert.equal(f.lot.charge_id,'charge');assert.equal(f.charge.pix_issue_code,'http_402:failed');assert.equal(f.resolved(),0);
 await Promise.all([f.api.recoverChargeOrder('charge'),f.api.recoverChargeOrder('charge')]);assert.equal(f.attempts.length,1);
 f.clearLease();await f.api.recoverChargeOrder('charge');assert.equal(f.attempts.length,2);assert.ok(f.attempts.every(a=>a.externalReference==='stable-reference'));
});
test('QR recuperado preserva cobrança; falha terminal verificada libera somente o vínculo',async()=>{
 const valid=fixture();await valid.api.recoverChargeOrder('charge');assert.equal(valid.charge.mp_payment_id,'ORD_same');assert.equal(valid.charge.qr_code,'fixture-qr');assert.equal(valid.lot.charge_id,'charge');assert.equal(valid.resolved(),1);
 const failed=fixture({terminal:true});await failed.api.recoverChargeOrder('charge');assert.equal(failed.charge.status,'rejected');assert.equal(failed.lot.charge_id,null);assert.equal(failed.lot.status,'pending_payment');assert.equal(failed.charge.pix_issue_code,'provider:rejected,rejected');assert.ok(failed.resolved()>0);
});
test('pagamento confirmado durante a recuperação nunca é sobrescrito por falha tardia',async()=>{
 const f=fixture({terminal:true,concurrentPaid:true});await f.api.recoverChargeOrder('charge');assert.equal(f.charge.status,'approved');assert.equal(f.lot.status,'paid');assert.equal(f.lot.charge_id,'charge');
});
