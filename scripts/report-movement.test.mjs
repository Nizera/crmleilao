import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/report-movement.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});
const {filterReportMovement}=exports;
const days=['2026-11-10','2026-11-17','2026-11-24'];
const fixture=()=>days.map(day=>({customerId:day,name:day,lots:[
 {id:`new-${day}`,shippingDate:day,movedAt:null,status:'paid'},
 {id:`moved-${day}`,shippingDate:day,movedAt:'2026-11-16T13:00:00Z',status:'paid'},
 {id:`sent-${day}`,shippingDate:day,movedAt:null,dispatched:true,status:'shipped'},
],logisticsPending:[
 {id:`prize-new-${day}`,shippingDate:day,moved_at:null},
 {id:`prize-moved-${day}`,shippingDate:day,moved_at:'2026-11-16T13:00:00Z'},
 {id:`prize-sent-${day}`,shippingDate:day,moved_at:null,dispatched:true},
],storeOrders:[
 {id:`store-new-${day}`,shippingDate:day,boxed_at:null},
 {id:`store-moved-${day}`,shippingDate:day,boxed_at:'2026-11-16T13:00:00Z'},
 {id:`store-sent-${day}`,shippingDate:day,boxed_at:null,dispatched:true},
]}));
const ids=rows=>rows.flatMap(c=>[...c.lots,...c.logisticsPending,...c.storeOrders].map(i=>i.id));

test('date and movement matrix: exact date; moved/unmoved are disjoint and together cover all',()=>{
 const source=fixture();
 for(const day of [...days,'all']){
  const all=ids(filterReportMovement(source,day,'all'));
  const moved=ids(filterReportMovement(source,day,'moved'));
  const unmoved=ids(filterReportMovement(source,day,'unmoved'));
  const n=day==='all'?3:1;
  assert.equal(all.length,9*n);assert.equal(moved.length,6*n);assert.equal(unmoved.length,3*n);
  assert.equal(moved.filter(id=>unmoved.includes(id)).length,0);
  assert.deepEqual([...moved,...unmoved].sort(),[...all].sort());
  if(day!=='all')assert.ok(all.every(id=>id.endsWith(day)));
  assert.ok(unmoved.every(id=>id.startsWith('new-') || id.includes('-new-')),'sent items never return to the separation queue');
 }
 for(const filter of ['all','moved','unmoved']){
  assert.deepEqual(ids(filterReportMovement(source,'all',filter)).sort(),days.flatMap(day=>ids(filterReportMovement(source,day,filter))).sort());
 }
 assert.equal(source[0].lots[2].movedAt,null,'never invent a movement timestamp');
});

test('joins and customer groups cannot repeat the same item; real different IDs remain distinct',()=>{
 const source=fixture();source[0].lots.push(source[0].lots[0]);source.push({...source[0]});
 for(const filter of ['all','moved','unmoved']){
  const visible=ids(filterReportMovement(source,'all',filter));
  assert.equal(visible.length,new Set(visible).size);
 }
 const updated=fixture();updated[1].lots[0].movedAt='2026-11-17T10:00:00Z';
 assert.ok(!ids(filterReportMovement(updated,'2026-11-17','unmoved')).includes('new-2026-11-17'));
 assert.ok(ids(filterReportMovement(updated,'all','moved')).includes('new-2026-11-17'));
});

test('a customer with no matches stays empty instead of showing other clients',()=>{
 const source=fixture();
 assert.equal(filterReportMovement(source,'2026-11-17','all','2026-11-10').length,0);
 assert.equal(filterReportMovement(source,'all','all','removed-customer').length,0);
 const selected=filterReportMovement(source,'all','all','2026-11-17');
 assert.equal(selected.length,1);assert.equal(selected[0].customerId,'2026-11-17');
});
