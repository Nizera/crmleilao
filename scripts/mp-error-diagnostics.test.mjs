import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

test('HTTP 402 preserva códigos de processamento sem expor dados do pagador',async()=>{
 const source=(await readFile(new URL('../src/lib/mercadopago.ts',import.meta.url),'utf8')).replace('import "server-only";','').replace('import { siteUrl } from "@/lib/lots";','const siteUrl=()=>"https://example.invalid";');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 const {createPixOrder,mpFailureCodes}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 const payload={status:'failed',errors:[{code:'processing_error',message:'payer@example.invalid secret-token'}],transactions:{payments:[{status_detail:'rejected_by_bank'}]},payer:{email:'payer@example.invalid'}};
 assert.deepEqual(mpFailureCodes(payload),['failed','processing_error','rejected_by_bank']);
 const original=globalThis.fetch,token=process.env.MP_ACCESS_TOKEN;
 try{
  process.env.MP_ACCESS_TOKEN='test-only';let calls=0;
  globalThis.fetch=async()=>{calls++;return Response.json(payload,{status:402});};
  await assert.rejects(createPixOrder({amount:10,description:'fixture',externalReference:'fixture',payerEmail:'payer@example.invalid'},{waitForQr:false}),error=>{
   assert.match(error.message,/HTTP 402.*processing_error.*rejected_by_bank/);
   assert.doesNotMatch(error.message,/payer@|secret-token/);return true;
  });
  assert.equal(calls,1);
 }finally{globalThis.fetch=original;if(token===undefined)delete process.env.MP_ACCESS_TOKEN;else process.env.MP_ACCESS_TOKEN=token;}
});

test('402 com order: só recupera após GET autenticado com referência e valor iguais',async()=>{
 const source=(await readFile(new URL('../src/lib/mercadopago.ts',import.meta.url),'utf8')).replace('import "server-only";','').replace('import { siteUrl } from "@/lib/lots";','const siteUrl=()=>"https://example.invalid";');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 const {createPixOrder}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 const original=globalThis.fetch,token=process.env.MP_ACCESS_TOKEN;
 try{
  process.env.MP_ACCESS_TOKEN='test-only';
  for(const reference of ['expected','other']){
   const calls=[];
   globalThis.fetch=async(url,options)=>{calls.push({url,options});return options.method==='POST'?Response.json({id:'ORD_failed_test',status:'failed',errors:[{code:'failed'}]},{status:402}):Response.json({id:'ORD_failed_test',status:'failed',status_detail:'rejected',total_amount:'10.00',external_reference:reference,transactions:{payments:[{status:'failed',status_detail:'specific_rejection'}]}});};
   const attempt=createPixOrder({amount:10,description:'fixture',externalReference:'expected',payerEmail:'fixture@example.invalid'},{waitForQr:false});
   if(reference==='expected'){const order=await attempt;assert.equal(order.orderId,'ORD_failed_test');assert.equal(order.status,'failed');assert.equal(order.statusDetail,'specific_rejection');assert.equal(order.qrCode,null);}else await assert.rejects(attempt,/402/);
   assert.equal(calls.length,2);assert.equal(calls.filter(c=>c.options.method==='POST').length,1);
   assert.equal(calls[0].options.headers['X-Idempotency-Key'],'expected');
  }
  globalThis.fetch=async(_url,options)=>options.method==='POST'?Response.json({order_id:'ORD_failed_test'},{status:402}):Response.json({id:'ORD_failed_test',status:'failed',total_amount:'99.00',external_reference:'expected'});
  await assert.rejects(createPixOrder({amount:10,description:'fixture',externalReference:'expected',payerEmail:'fixture@example.invalid'},{waitForQr:false}),/402/);
 }finally{globalThis.fetch=original;if(token===undefined)delete process.env.MP_ACCESS_TOKEN;else process.env.MP_ACCESS_TOKEN=token;}
});
