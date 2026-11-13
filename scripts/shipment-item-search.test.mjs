import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
function load(file,deps={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>{if(!(n in deps))throw Error(n);return deps[n];}});return exports;}
const search=load('src/lib/shipment-item-search.ts');
test('busca ignora acentos, maiúsculas e espaços; combina palavras',()=>{
 assert.equal(search.matchesShipmentItem('DIAZ LILÁS · Card','  diaz   lilas '),true);
 assert.equal(search.matchesShipmentItem('Messi Ouro','messi prata'),false);
 assert.equal(search.shipmentSearchKey({customerId:'c',pendingShipment:{id:'s'}}),'shipment:s');
});
test('pesquisa diferencia conteúdo da etiqueta, itens futuros e fila do mesmo cliente',async()=>{
 const data={lots:[{id:'a',title:'Card',description:'Original',items:[{color:'ouro',player:{name:'Lionel Messi'}}]},{id:'b',title:'Álbum',description:'Capa dura',items:[]}],logistics_pending:[{customer_id:'c',title:'Diaz Lilás',reason:'Rifa',shipping_date:'2026-11-17',shipment_id:null},{customer_id:'c',title:'Salah',reason:'Rifa anterior',shipping_date:'2026-11-10',shipment_id:'s'},{customer_id:'c',title:'Futuro',shipping_date:'2026-11-24',shipment_id:null}],store_orders:[{customer_id:'c',shipment_id:'s',payment_status:'paid',items:[{name:'Camiseta',delivery_kind:'physical'}]}]};
 let calls=0;const db={from(table){calls++;let rows=data[table]??[];const q={select(){return q},order(){return q},range(from,to){rows=rows.slice(from,to+1);return q},in(k,ids){rows=rows.filter(r=>ids.includes(r[k]));return q},is(){return q},eq(k,v){rows=rows.filter(r=>r[k]===v);return q},then(resolve){return Promise.resolve({data:rows,error:null}).then(resolve)}};return q}};
 const {findShipmentItems}=load('src/lib/shipment-item-search-server.ts',{'server-only':{},'@/lib/supabase/admin':{createAdminClient:()=>db},'./shipment-item-search':search});
 const rows=[{customerId:'c',pendingShipment:{id:'s'},lots:[{id:'a',code:'A',title:'Card'}]},{customerId:'c',pendingShipment:null,lots:[{id:'b',code:'B',title:'Álbum'}]}];
 const match=async q=>Array.from(await findShipmentItems(rows,q,'2026-11-17'));
 assert.deepEqual(await match('messi ouro'),['shipment:s']);
 assert.deepEqual(await match('diaz lilas'),['customer:c']);
 assert.deepEqual(await match('camiseta'),['shipment:s']);
 assert.deepEqual(await match('futuro'),[]);
 const before=calls;assert.equal((await match('')).length,2);assert.equal(calls,before,'sem filtro não consulta novamente o banco');
});
