import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import * as crypto from 'node:crypto';
test('cron de lotes exige autenticação, verifica assinatura temporal e invalida dashboard',async()=>{
 const secret='fixture-secret-for-tests-only';let calls=0,tags=0;
 const deps={'node:crypto':crypto,'next/cache':{revalidatePath(){},revalidateTag(tag,opts){assert.equal(tag,'dashboard');assert.equal(opts.expire,0);tags++;}},'@/lib/auction-expiration-server':{reconcileAuctionDeadlines:async()=>{calls++;return {failed:0,cancelled:1}}}};
 const api={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/app/api/cron/auction-expiration/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:api,Date,Response,process:{env:{CRON_SECRET:secret}},require:n=>deps[n]});
 const req=headers=>new Request('https://example.invalid/api/cron/auction-expiration',{headers});
 assert.equal((await api.GET(req({}))).status,401);assert.equal(calls,0);
 const timestamp=String(Math.floor(Date.now()/1000));const signature=crypto.createHmac('sha256',secret).update('auction-expiration:'+timestamp).digest('hex');
 assert.equal((await api.GET(req({'authorization':'Bearer '+signature,'x-auction-cron-time':timestamp}))).status,200);assert.equal(calls,1);assert.equal(tags,1);
 assert.equal((await api.GET(req({'authorization':'Bearer '+signature,'x-auction-cron-time':String(Number(timestamp)-120)}))).status,401);assert.equal(calls,1);
 assert.equal((await api.GET(req({'authorization':'Bearer errado','x-auction-cron-time':timestamp}))).status,401);
});
