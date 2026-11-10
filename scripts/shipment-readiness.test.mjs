import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file,deps={}) { const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>deps[name]??{}});return exports; }
const doc=load('src/lib/brazilian-document.ts');
const {recipientIssues,shipmentQueueIssues}=load('src/lib/shipment-readiness.ts',{'./brazilian-document':doc});
const recipient={name:'Cliente Teste',email:'fixture@example.invalid',cpf_cnpj:'52998224725',address_cep:'01001-000',address_street:'Praça da Sé',address_district:'Sé',address_city:'São Paulo',address_state:' sp '};
test('cadastro completo aceita formatação e não exige número quando S/N é permitido',()=>{
 assert.deepEqual(Array.from(recipientIssues(recipient)),[]);
 for(const [key,value] of Object.entries({name:' ',email:'sem-arroba',cpf_cnpj:'11111111111',address_cep:'00000000',address_street:' ',address_district:' ',address_city:' ',address_state:'XX'})) assert.equal(recipientIssues({...recipient,[key]:value}).length,1,key);
 assert.match(recipientIssues({...recipient,name:'Filipe'})[0],/sobrenome/);
 assert.ok(recipientIssues({...recipient,cpf_cnpj:'52998224724'}).some(v=>v.includes('CPF')));
});
test('alertas de fila juntam cadastro e pagamentos sem expor dados pessoais',()=>{
 const ready={unpaidTotal:0,blockingUnpaidTotal:0,hasActiveCharge:false,freightStatus:'paid'};
 assert.equal(shipmentQueueIssues(ready).length,0);
 assert.equal(shipmentQueueIssues({...ready,blockingUnpaidCount:1}).length,1);
 const issues=shipmentQueueIssues({...ready,recipientIssues:recipientIssues({...recipient,address_street:null}),blockingUnpaidTotal:50,hasActiveCharge:true,freightStatus:'due'});
 assert.equal(issues.length,4);assert.ok(!JSON.stringify(issues).includes(recipient.cpf_cnpj));
 assert.equal(shipmentQueueIssues({...ready,companyFreight:true,freightStatus:'none'}).length,0);
 assert.equal(shipmentQueueIssues({...ready,companyFreight:true,freightStatus:'none',unpaidTotal:50,blockingUnpaidTotal:50}).length,1);
});
