import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';import vm from 'node:vm';
const api={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/shipment-list.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:api});
test('uma linha por etiqueta sem duplicar lotes já vinculados; pendentes restantes preservados',()=>{
 const shipment={id:'s1',customer_id:'c',batch_date:'2026-11-03',status:'released',price:25,original_price:20,lots:[{id:'l1',code:'L1',title:'Lote'}]};
 const lot=id=>({id,code:id,title:id,status:'paid',arremate_value:10});
 const queue=[{customerId:'c',name:'Teste',phone_e164:'',lots:[lot('l1'),lot('l2')],paidTotal:20,unpaidTotal:0,pendingShipment:shipment,freightStatus:'paid',hasActiveCharge:false}];
 const rows=api.unifiedShipmentRows(queue,[shipment]);assert.equal(rows.length,2);assert.equal(rows.filter(r=>r.pendingShipment).length,1);assert.equal(rows[0].lots.length,1);assert.equal(rows[1].lots[0].id,'l2');
});
test('postados, múltiplas etiquetas por cliente e cancelados não desaparecem; resumo não depende da página',()=>{
 const labels=[{id:'a',customer_id:'c',status:'posted',price:37.78,original_price:31.73},{id:'b',customer_id:'c',status:'delivered',price:10,original_price:12},{id:'c',customer_id:'c',status:'cancelled',price:999,original_price:999}];
 const rows=api.unifiedShipmentRows([],labels);assert.equal(rows.length,3);const summary=api.shipmentListSummary(rows);assert.equal(summary.labels,2);assert.equal(summary.cancelled,1);assert.equal(summary.currentTotal,47.78);assert.equal(summary.emissionTotal,43.73);assert.equal(summary.adjustmentTotal,4.05);assert.equal(summary.changedLabels,2);
 const filtered=api.shipmentListSummary(rows.filter(r=>r.pendingShipment.status==='posted'));assert.equal(filtered.labels,1);assert.equal(filtered.currentTotal,37.78);
});
