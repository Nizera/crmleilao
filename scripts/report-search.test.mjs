import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
function load(file,deps={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>deps[n]});return exports;}
const search=load('src/lib/shipment-item-search.ts');const{filterReportCustomers}=load('src/lib/report-search.ts',{'./shipment-item-search':search});
const fixture=()=>[{customerId:'a',name:'Cliente Exemplo',phone_e164:'+5511999991234',lots:[{id:'l1',code:'ABC123',title:'Kit',description:'Card original',notes:'Ótimo estado',movedItems:[],searchItems:['1 × Messi · Ouro']},{id:'l2',code:'DEF456',title:'Outro lote',description:'Álbum',notes:null,movedItems:[]}],logisticsPending:[{id:'p1',code:'PEN-123',title:'Diaz Lilás',reason:'Prêmio de rifa'}],storeOrders:[{id:'s1',code:'LJ-123',items:[{name:'Camiseta'}]}]}];
test('pesquisa por jogador, código, descrição, prêmio e produto sem repetir nem alterar a origem',()=>{
 const rows=fixture(),snapshot=JSON.stringify(rows);
 assert.equal(filterReportCustomers(rows,'messi ouro')[0].lots[0].id,'l1');
 assert.equal(filterReportCustomers(rows,'ABC123')[0].lots.length,1);
 assert.equal(filterReportCustomers(rows,'card original')[0].lots[0].id,'l1');
 assert.equal(filterReportCustomers(rows,'diaz lilas')[0].logisticsPending[0].id,'p1');
 assert.equal(filterReportCustomers(rows,'camiseta')[0].storeOrders[0].id,'s1');
 assert.equal(filterReportCustomers(rows,'inexistente').length,0);
 assert.equal(filterReportCustomers(rows,'cliente exemplo')[0].lots.length,2);
 assert.equal(filterReportCustomers(rows,'999991234')[0].lots.length,2);
 assert.equal(JSON.stringify(rows),snapshot);
});
test('a busca não traz de volta itens que já ficaram fora dos filtros de data ou movimentação',()=>{
 const rows=fixture();rows[0].lots=[];
 assert.equal(filterReportCustomers(rows,'messi').length,0);
 assert.equal(filterReportCustomers(rows,'')[0].logisticsPending.length,1);
});
