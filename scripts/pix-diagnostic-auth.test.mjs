import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import * as crypto from 'node:crypto';
test('diagnóstico Pix: assinatura por cobrança, prazo curto, somente leitura e sem dados pessoais',async()=>{
 const secret='fixture-private-secret-only',charge=crypto.randomUUID(),other=crypto.randomUUID();let reads=0,providerReads=0;
 const db={from(){reads++;return {select(){return this},eq(){return this},maybeSingle:async()=>({data:{status:'rejected',mp_payment_id:'ORD_fixture',external_reference:'reference',amount:90},error:null})}}};
 const deps={'node:crypto':crypto,'@/lib/supabase/admin':{createAdminClient:()=>db},'@/lib/mercadopago':{getOrder:async()=>{providerReads++;return {status:'failed',statusDetail:'high_risk',externalReference:'reference',amount:90,raw:{payer:{email:'private@example.invalid'},transactions:{payments:[{status:'failed',status_detail:'high_risk'}]}}};},mpFailureCodes:()=>['failed','high_risk'],qrFrom:()=>({qrCode:null})}};
 const api={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/app/api/internal/pix-diagnostic/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:api,Date,URL,Response,process:{env:{CRON_SECRET:secret}},require:n=>deps[n]});
 const timestamp=String(Math.floor(Date.now()/1000));const signature=crypto.createHmac('sha256',secret).update(`pix-diagnostic:${charge}:${timestamp}`).digest('hex');
 const req=(id=charge,t=timestamp,auth='Bearer '+signature)=>new Request('https://example.invalid/api/internal/pix-diagnostic?charge='+id,{headers:{authorization:auth,'x-pix-diagnostic-time':t}});
 assert.equal((await api.GET(req(charge,timestamp,'bad'))).status,401);assert.equal((await api.GET(req(other))).status,401);assert.equal((await api.GET(req(charge,String(Number(timestamp)-120)))).status,401);assert.equal(reads,0);
 const r=await api.GET(req());assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);const data=await r.json();assert.equal(data.detail,'high_risk');assert.equal(data.amountMatches,true);assert.equal(data.referenceMatches,true);assert.equal(data.hasQr,false);assert.equal(reads,1);assert.equal(providerReads,1);
 assert.doesNotMatch(JSON.stringify(data),/private@example|ORD_fixture|reference\"|\"amount\"|payer/);
});
