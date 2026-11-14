import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';import vm from 'node:vm';
const api={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/shipment-queue-pages.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:api,Error});
test('data selecionada carrega mais de mil registros sem paginação visível nem perda da última página',async()=>{
 const ids=Array.from({length:1737},(_,id)=>({id}));let calls=0;
 const rows=await api.collectShipmentQueueRows(async(from,to)=>{calls++;return{data:ids.slice(from,to+1),error:null}},true);
 assert.equal(rows.length,1737);assert.equal(new Set(rows.map(r=>r.id)).size,1737);assert.equal(calls,4);
});
test('falha em página interna não apresenta lista parcial como completa',async()=>{
 await assert.rejects(api.collectShipmentQueueRows(async(from)=>from?{data:null,error:{message:'falha'}}:{data:Array(500).fill(1),error:null},true),/falha/);
});
test('consulta sem uma data específica mantém proteção contra varredura ilimitada',async()=>{
 let calls=0;const rows=await api.collectShipmentQueueRows(async()=>{calls++;return{data:Array(500).fill(1),error:null}},false);assert.equal(calls,3);assert.equal(rows.length,1500);
});
