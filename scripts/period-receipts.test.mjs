import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const read=p=>readFile(new URL('../src/lib/'+p,import.meta.url),'utf8');
const url=s=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64');
const dates=url(await read('dates.ts')),freight=url(await read('freight.ts'));
const period=url((await read('auction-period.ts')).replace('"@/lib/dates"',JSON.stringify(dates)));
const {resolveAuctionPeriod}=await import(period);
const {computePeriodReceipts}=await import(url((await read('period-receipts.ts')).replace('"@/lib/auction-period"',JSON.stringify(period)).replace('"@/lib/freight"',JSON.stringify(freight))));
const thu=resolveAuctionPeriod('2026-11-05'),tue=resolveAuctionPeriod('2026-11-03');
const lot={status:'paid',paid_at:'2026-11-05T18:30:00-03:00',created_at:'2026-11-03T20:00:00-03:00',arremate_value:80};
const charge={id:'pix',customer_id:'a',status:'approved',paid_at:lot.paid_at,freight_amount:20};
test('terça cadastro / quinta pagamento: lote e frete entram na quinta, uma vez',()=>{
 assert.equal(computePeriodReceipts([lot],[charge],[],tue).total,0);
 const r=computePeriodReceipts([lot],[charge,charge],[],thu);assert.equal(r.lotsTotal,80);assert.equal(r.freightTotal,20);assert.equal(r.total,100);assert.equal(r.paidLots,1);assert.equal(r.byDay.qui,20);
});
test('intervalo SP inclui início e exclui fim; não puxa pagos depois ou créditos antigos',()=>{
 const r=computePeriodReceipts([{...lot,paid_at:thu.startUtc},{...lot,paid_at:thu.endUtc}],[{...charge,paid_at:thu.startUtc},{...charge,id:'fim',paid_at:thu.endUtc},{...charge,id:'antigo',paid_at:'2026-11-03T18:00:00Z'}],[],thu);
 assert.equal(r.total,100);assert.equal(computePeriodReceipts([{...lot,status:'cancelled'}],[{...charge,status:'refunded'},{...charge,id:'null',paid_at:null}],[],thu).total,0);
});
test('frete da loja entra sem preço dos produtos; IDs de fontes diferentes não se confundem',()=>{
 const r=computePeriodReceipts([lot],[charge],[{...charge,status:'paid',cash_total:500}],thu);assert.equal(r.freightTotal,40);assert.equal(r.total,120);assert.equal(r.paidCustomers,1);
});
test('consulta de fretes pagina, usa paid_at e inclui pagadores sem lote cadastrado no filtro',async()=>{
 const calls=[];const rows=Array.from({length:501},(_,id)=>({...charge,id:String(id)}));
 const db={from(table){const filters=[];return {select(){return this},eq(...a){filters.push(a);return this},gt(...a){filters.push(a);return this},gte(...a){filters.push(a);return this},lt(...a){filters.push(a);return this},order(){return this},async range(from,to){calls.push({table,filters});return {data:table==='charges'?rows.slice(from,to+1):[],error:null}}}}};
 const source=(await read('period-receipts-server.ts')).replace('import "server-only";','');
 const {loadFreightReceipts}=await import(url(source));const r=await loadFreightReceipts(db,thu);assert.equal(r.charges.length,501);assert.equal(r.store.length,0);assert.equal(calls.length,3);assert.ok(calls.every(c=>c.filters.some(f=>f[0]==='paid_at'&&f[1]===thu.startUtc)));assert.ok(!calls.some(c=>c.filters.some(f=>f[0]==='customer_id'||f[0]==='created_at')));
});
