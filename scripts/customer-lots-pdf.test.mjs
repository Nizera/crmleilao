import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';import * as pdfLib from 'pdf-lib';import {z} from 'zod';
function load(file,deps={}){const exports={};new Function('exports','require',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exports,n=>{if(!(n in deps))throw Error(n);return deps[n];});return exports;}
const pdf=load('src/lib/customer-lots-pdf.ts',{'pdf-lib':pdfLib});
const cid='22222222-2222-4222-8222-222222222222',lid='11111111-1111-4111-8111-111111111111';
const lot=(extra={})=>({id:lid,code:'ABC12345',title:'Messi Ouro',description:'Figurinha original',auction_date:'2026-11-13',arremate_value:80,discount_amount:20,status:'paid',customer_id:cid,...extra});
test('seleção limita cliente, IDs repetidos, quantidade e valores; arquivo tem nome seguro',()=>{
 assert.equal(pdf.validateCustomerPdfLots([lot()]),cid);
 assert.throws(()=>pdf.validateCustomerPdfLots([lot(),lot({id:crypto.randomUUID(),customer_id:'outro'})]),/mesmo cliente/);
 assert.throws(()=>pdf.validateCustomerPdfLots([lot(),lot()]),/repetidos/);
 assert.throws(()=>pdf.validateCustomerPdfLots([lot({status:'cancelled'})]),/cancelados/);
 assert.throws(()=>pdf.validateCustomerPdfLots([lot({arremate_value:NaN})]),/valores/);
 assert.throws(()=>pdf.validateCustomerPdfLots(Array.from({length:201},()=>lot())),/200/);
 assert.equal(pdf.customerPdfFilename('../José / Silva\r\n'), 'arremates-Jose-Silva.pdf');
});
test('PDF real suporta acentos, emoji removido com segurança, descrições longas e várias páginas',async()=>{
 const bytes=await pdf.createCustomerLotsPdf('José da Silva 🏆',Array.from({length:75},(_,i)=>lot({id:crypto.randomUUID(),code:`LOTE${i}`,description:'Descrição detalhada '.repeat(45),status:i%2?'pending_payment':'paid'})));
 const doc=await pdfLib.PDFDocument.load(bytes);assert.ok(doc.getPageCount()>1);assert.match(doc.getTitle(),/José da Silva/);
 fs.mkdirSync('tmp/pdfs',{recursive:true});fs.writeFileSync('tmp/pdfs/arremates-stress.pdf',bytes);
});
test('servidor reconsulta valores e cliente; rejeita mistura e não exporta para quem não é admin',async()=>{
 let allowed=true,rows=[lot()],reads=0;
 const db={from(table){reads++;return {select(){return this},in(){return Promise.resolve({data:rows,error:null})},eq(){return this},single:async()=>({data:{name:'Cliente do Banco'},error:null})}}};
 const{downloadCustomerLotsPdf}=load('src/app/actions/customer-lots-pdf.ts',{'zod':{z},'@/lib/dal':{requireAdmin:async()=>{if(!allowed)throw Error('negado');return {profile:{role:'owner'}}}},'@/lib/supabase/server':{createClient:async()=>db},'@/lib/result':{rethrowIfRedirect(){}},'@/lib/customer-lots-pdf':pdf});
 let result=await downloadCustomerLotsPdf([lid]);assert.equal(result.ok,true);assert.equal(result.data.filename,'arremates-Cliente-do-Banco.pdf');assert.ok((await pdfLib.PDFDocument.load(Buffer.from(result.data.base64,'base64'))).getPageCount());
 rows=[lot(),lot({id:'33333333-3333-4333-8333-333333333333',customer_id:'outro'})];result=await downloadCustomerLotsPdf(rows.map(l=>l.id));assert.equal(result.ok,false);assert.match(result.error,/mesmo cliente/);
 allowed=false;const before=reads;assert.equal((await downloadCustomerLotsPdf([lid])).ok,false);assert.equal(reads,before);
});
