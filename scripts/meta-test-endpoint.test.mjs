import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,createHmac} from 'node:crypto';
import ts from 'typescript';

test('test-only endpoint: signed request, expired/tampered rejection, mandatory test code and no live mode',async()=>{
 const source=await readFile(new URL('../src/app/api/internal/meta-test/route.ts',import.meta.url),'utf8');
 let code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 code=code.replace(/import \{ metaConfiguration \} from ['"]@\/lib\/meta-conversions-server['"];?/,"const metaConfiguration=()=>({enabled:true,pixel:'1074294225103386',token:'test-protected-token',version:'v25.0'});");
 const {POST}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
 const originalFetch=globalThis.fetch,oldSecret=process.env.CRON_SECRET;process.env.CRON_SECRET='test-signing-secret';
 const eventId='ocdl_meta_test_'+crypto.randomUUID(),data={testCode:'TEST65428',eventId};let calls=0;
 const request=(body=data,time=Math.floor(Date.now()/1000),signatureBody=body)=>{
  const raw=JSON.stringify(body),digest=createHash('sha256').update(JSON.stringify(signatureBody)).digest('hex');
  const hmac=createHmac('sha256',process.env.CRON_SECRET).update(`meta-test:${time}:${digest}`).digest('hex');
  return new Request('https://shop.invalid/api/internal/meta-test',{method:'POST',headers:{'x-meta-test-time':String(time),Authorization:'Bearer '+hmac},body:raw});
 };
 try{
  globalThis.fetch=async(_url,options)=>{calls++;const payload=JSON.parse(options.body);assert.equal(payload.test_event_code,'TEST65428');assert.equal(payload.data[0].event_name,'Purchase');assert.equal(payload.data[0].event_id,eventId);assert.equal(payload.data[0].custom_data.value,45);assert.equal(payload.data[0].custom_data.currency,'BRL');assert.equal(options.headers.Authorization,'Bearer test-protected-token');return Response.json({events_received:1,fbtrace_id:'test-trace'});};
  assert.equal((await POST(new Request('https://shop.invalid',{method:'POST'}))).status,401);
  assert.equal((await POST(request(data,Math.floor(Date.now()/1000)-120))).status,401);
  assert.equal((await POST(request({...data,testCode:'TEST12345'},undefined,data))).status,401);
  assert.equal((await POST(request({eventId}))).status,400);
  assert.equal((await POST(request({...data,testCode:''}))).status,400);assert.equal(calls,0);
  const result=await POST(request());assert.equal(result.status,200);const text=await result.text();assert.equal(JSON.parse(text).eventsReceived,1);assert.ok(!text.includes('test-protected-token'));assert.equal(calls,1);
  globalThis.fetch=async()=>Response.json({error:{code:190,message:'private provider details'}},{status:400});
  const failed=await POST(request());assert.equal(failed.status,502);assert.deepEqual(await failed.json(),{error:'meta_rejected',code:190});
 }finally{globalThis.fetch=originalFetch;if(oldSecret===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=oldSecret;}
});
