import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const customer = id => ({ id, name: 'Cliente teste', phone_e164: '+5511000000000' });
const lot = (id, customerId, status = 'paid') => ({ id, code: id, title: 'Figurinha teste', status, arremate_value: 100, charge_id: null, shipping_date: '2026-11-03', created_at: '2026-10-29T12:00:00Z', customers: customer(customerId), customer_id: customerId, moved_at: null });

function reportLoader({ missing = true, queryError, lots = [], issues = [], freightError = false, freight = [], links = [], releases = [], charges = [], releaseError = false, orders = [] } = {}) {
  const calls = [];
  const db = { from(table) {
    const call = { table, select: '' };
    calls.push(call);
    let rows = [...({ lots, logistics_pending: issues, charges, lot_items: [], shipment_lots: links, external_prize_freight_releases: releases, store_orders:orders }[table] ?? [])];
    const field = (row, key) => key.split('.').reduce((value, part) => value?.[part], row);
    return {
      select(value) { call.select = value; return this; },
      eq(key, value) { rows = rows.filter(row => field(row,key) === value); return this; },
      neq(key, value) { rows = rows.filter(row => field(row,key) !== value); return this; },
      lte(key, value) { rows = rows.filter(row => field(row,key) <= value); return this; },
      lt(key, value) { rows = rows.filter(row => field(row,key) < value); return this; },
      is(key, value) { rows = rows.filter(row => (field(row,key) ?? null) === value); return this; },
      in(key, values) { rows = rows.filter(row => values.includes(field(row,key))); return this; },
      order() { return this; },
      range(from, to) { rows = rows.slice(from,to+1); return this; },
      then(resolve) {
        const error = table === 'logistics_pending' ? queryError ?? (missing ? { code: 'PGRST205' } : null) : table === 'external_prize_freight_releases' && releaseError ? {code:'42501'} : null;
        return Promise.resolve({ data: error ? null : rows, error }).then(resolve);
      },
    };
  }, async rpc(name) {
    return name === 'shipping_freight_states' ? { data: freight, error: freightError ? { message: 'unavailable' } : null } : { data: [], error: null };
  } };
  const exports = {};
  const dependencies = {
    '@/lib/dates': {spToday:()=> '2026-11-11',spDayOf:date=>new Date(new Date(date).getTime()-3*3600000).toISOString().slice(0,10)},
    '@/lib/lots':{nextShippingDate:day=>{const date=new Date(day+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+((2-date.getUTCDay()+7)%7||7));return date.toISOString().slice(0,10)}},
    'server-only': {}, '@/lib/notes': { loadNotes: async () => new Map() },
    '@/lib/supabase/admin': { createAdminClient: () => db },
    '@/lib/supabase/server': { createClient: async () => db },
    '@/lib/charges': { isChargeActive: charge => ['pending','in_process'].includes(charge.status) },
  };
  const source = ts.transpileModule(readFileSync('src/lib/reports-server.ts','utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, require: name => { if (!(name in dependencies)) throw new Error(name); return dependencies[name]; } });
  return { load: (day = '2026-11-03') => exports.getSeparationReport(day), calls };
}

test('Migration ausente não derruba relatório vazio e retorna aviso também para impressão', async () => {
  const { load, calls } = reportLoader();
  const report = await load();
  assert.equal(report.customers.length, 0);
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0], /migration 0035/);
  assert.equal(calls.filter(call => call.table === 'logistics_pending').length,1);
});

test('Sem migration, lotes pagos continuam no relatório e clientes com pendências financeiras ficam bloqueados', async () => {
  const { load } = reportLoader({ lots: [lot('paid','a'),lot('blocked','b'),lot('unpaid','b','pending_payment')], freight: [{ customer_id: 'a', status: 'paid' },{ customer_id: 'b', status: 'paid' }] });
  const report = await load();
  assert.equal(report.customers.length,1);
  assert.equal(report.customers[0].customerId,'a');
  assert.equal(report.totals.excludedCustomers,1);
  assert.equal(report.warnings.length,1);
});

test('Falha de permissão ou frete não é confundida com migration ausente', async () => {
  await assert.rejects(reportLoader({ queryError: { code: '42501' } }).load(), /Não foi possível conferir/);
  await assert.rejects(reportLoader({ lots: [lot('paid','a')], freightError: true }).load(), /pagamentos e fretes/);
});

test('Com migration, reposições e lotes são agrupados no mesmo cliente sem aviso', async () => {
  const issue = { id: 'issue', code: 'PEN-TESTE', title: 'Reposição', quantity: 1, reason: 'Item faltante', shipping_date: '2026-11-03', cancelled_at: null, shipment_id: null, moved_at: null, customers: customer('a') };
  const report = await reportLoader({ missing: false, lots: [lot('paid','a')], issues: [issue], freight: [{ customer_id: 'a', status: 'paid' }] }).load();
  assert.equal(report.warnings.length,0);
  assert.equal(report.customers.length,1);
  assert.equal(report.customers[0].lots.length,1);
  assert.equal(report.customers[0].logisticsPending[0].code,'PEN-TESTE');
});

test('11 lotes do pacote liberado permanecem no relatório apesar de três pendências e frete de envio futuro', async () => {
  const selected=Array.from({length:11},(_,i)=>lot('paid-'+i,'a'));
  const future=Array.from({length:3},(_,i)=>({...lot('future-'+i,'a','pending_payment'),shipping_date:'2026-11-10',charge_id:'future-charge'}));
  const links=selected.map(l=>({lot_id:l.id,shipment:{batch_date:'2026-11-03',status:'released'}}));
  const report=await reportLoader({lots:[...selected,...future],links,
    charges:[{id:'future-charge',customer_id:'a',status:'pending'}],freight:[{customer_id:'a',status:'due'}]}).load();
  assert.equal(report.customers.length,1);
  assert.equal(report.customers[0].lots.length,11);
  assert.equal(report.totals.excludedCustomers,0);
  assert.ok(report.customers[0].lots.every(l=>l.id.startsWith('paid-')));
});

test('envio ainda sem etiqueta considera somente pendências até a data selecionada',async()=>{
  const paid=lot('paid','a');
  const future={...lot('future','a','pending_payment'),shipping_date:'2026-11-10',charge_id:'future-charge'};
  const report=await reportLoader({lots:[paid,future],charges:[{id:'future-charge',customer_id:'a',status:'pending'}],freight:[{customer_id:'a',status:'paid'}]}).load();
  assert.equal(report.customers.length,1);
  assert.equal(report.customers[0].lots[0].id,'paid');
});

test('liberar frete inclui só os prêmios zerados autorizados, sem exigir Pix ou paid_at',async()=>{
  const prize={...lot('prize','a'),arremate_value:0,paid_at:null};
  const ordinary=lot('ordinary','a');
  const noRelease={...lot('no-release','b'),arremate_value:0};
  const wrongCustomer={...lot('wrong-customer','c'),arremate_value:0};
  const report=await reportLoader({lots:[prize,ordinary,noRelease,wrongCustomer],
    releases:[{lot_id:'prize',customer_id:'a'},{lot_id:'ordinary',customer_id:'a'},{lot_id:'wrong-customer',customer_id:'a'}],
    freight:['a','b','c'].map(customer_id=>({customer_id,status:'none'}))}).load();
  assert.equal(report.customers.length,1);
  assert.equal(report.customers[0].lots.length,1);
  assert.equal(report.customers[0].lots[0].id,'prize');
  assert.equal(report.totals.excludedCustomers,2);
});

test('liberação de outro pacote ou cancelamento não contorna a conferência dos lotes selecionados',async()=>{
  const selected=['released','posted','delivered','cancelled','other-date','unlinked'].map(id=>lot(id,'a'));
  const links=selected.filter(l=>l.id!=='unlinked').map(l=>({lot_id:l.id,
    shipment:{batch_date:l.id==='other-date'?'2026-11-10':'2026-11-03',status:l.id==='other-date'?'released':l.id}}));
  const report=await reportLoader({lots:selected,links,freight:[{customer_id:'a',status:'due'}]}).load();
  assert.equal(report.customers[0].lots.map(l=>l.id).join(','),'released,posted,delivered');
});

test('cobrança aberta vinculada ao lote selecionado continua bloqueando pacote não liberado',async()=>{
  const report=await reportLoader({lots:[{...lot('paid','a'),charge_id:'charge'}],
    charges:[{id:'charge',customer_id:'a',status:'pending'}],freight:[{customer_id:'a',status:'paid'}]}).load();
  assert.equal(report.customers.length,0);
  assert.equal(report.totals.excludedCustomers,1);
});

test('falha ao consultar liberações de prêmios interrompe relatório em vez de esconder itens',async()=>{
  await assert.rejects(reportLoader({lots:[lot('paid','a')],releaseError:true}).load(),/liberações de frete/);
});


test('todas as datas reúne semanas anteriores, preserva movimentação e exclui etiquetas já liberadas',async()=>{
 const old={...lot('old','a'),shipping_date:'2026-10-27',moved_at:'2026-10-28T10:00:00Z'};
 const future={...lot('future','a','pending_payment'),shipping_date:'2026-11-17'};
 const issued=lot('issued','b');
 const issue={id:'replacement',shipping_date:'2026-10-20',customers:customer('a'),shipment_id:null,cancelled_at:null};
 const report=await reportLoader({missing:false,lots:[old,future,issued],issues:[issue],
   freight:[{customer_id:'a',status:'paid'},{customer_id:'b',status:'paid'}],
   links:[{lot_id:'issued',shipment:{batch_date:'2026-11-03',status:'posted'}}]}).load('all');
 assert.equal(report.shippingDate,'all');
 assert.equal(report.customers.length,1);
 assert.equal(report.customers[0].lots.length,1);
 assert.equal(report.customers[0].lots[0].id,'old');
 assert.equal(report.customers[0].lots[0].shippingDate,'2026-10-27');
 assert.ok(report.customers[0].lots[0].movedAt);
 assert.equal(report.customers[0].logisticsPending.length,1,'reposição vencida não é duplicada entre datas');
});


test('prêmios e pendências previstos para 10/11 não aparecem nos dias 11, 12 e 13',async()=>{
 const issues=['raffle','replacement'].flatMap(kind=>[
   {id:`${kind}-10`,title:kind,source_kind:kind,shipping_date:'2026-11-10',customers:customer('cleber'),shipment_id:null,cancelled_at:null,moved_at:'2026-11-12T05:00:00Z'},
   {id:`${kind}-17`,title:kind,source_kind:kind,shipping_date:'2026-11-17',customers:customer('cleber'),shipment_id:null,cancelled_at:null,moved_at:null},
 ]);
 const {load}=reportLoader({missing:false,issues});
 for(const day of ['2026-11-11','2026-11-12','2026-11-13']){
   const report=await load(day);assert.equal(report.customers.length,0,day);
 }
 const day10=await load('2026-11-10');assert.equal(day10.customers[0].logisticsPending.length,2);
 assert.ok(day10.customers[0].logisticsPending.every(item=>item.shippingDate==='2026-11-10'));
 const day17=await load('2026-11-17');assert.equal(day17.customers[0].logisticsPending.length,2);
 assert.ok(day17.customers[0].logisticsPending.every(item=>item.shippingDate==='2026-11-17'));
 const all=await load('all');assert.equal(all.customers[0].logisticsPending.length,4,'Todas as datas mantém cada item uma vez');
});

test('etiqueta não faz o mesmo item aparecer novamente em outra data',async()=>{
 const issue={id:'linked',shipping_date:'2026-11-03',customers:customer('cleber'),shipment_id:'s',cancelled_at:null,shipment:{code:'ENV-TESTE',batch_date:'2026-11-10'}};
 const {load}=reportLoader({missing:false,issues:[issue]});
 assert.equal((await load('2026-11-03')).customers[0].logisticsPending[0].shipmentCode,'ENV-TESTE');
 assert.equal((await load('2026-11-10')).customers.length,0);
 assert.equal((await load('2026-11-11')).customers.length,0);
 assert.equal((await load('all')).customers.length,0);
});


test('vários clientes e datas: cada ID aparece uma única vez e na respectiva data',async()=>{
 const days=['2026-11-03','2026-11-10','2026-11-17'];
 const lots=[],issues=[];
 for(const customerId of ['cleber','cliente-b','cliente-c'])for(const day of days){
   lots.push({...lot(`${customerId}-${day}`,customerId),shipping_date:day});
   for(const source_kind of ['raffle','replacement'])issues.push({id:`${source_kind}-${customerId}-${day}`,shipping_date:day,source_kind,customers:customer(customerId),cancelled_at:null,shipment_id:null,moved_at:null});
 }
 // Defesa adicional contra repetição nos resultados de joins/leitura.
 lots.push(lots[0]);issues.push(issues[0]);
 const orders=[{id:'store-a',code:'LJ-A',customer_id:'cleber',payment_status:'paid',fulfillment_status:'processing',shipment_id:null,created_at:'2026-11-01T10:00:00Z',boxed_at:null,items:[{name:'Card',quantity:1,delivery_kind:'physical'}]}];
 orders.push(orders[0]);
 const {load}=reportLoader({missing:false,lots,issues,orders,freight:['cleber','cliente-b','cliente-c'].map(customer_id=>({customer_id,status:'paid'}))});
 for(const day of days){
   const report=await load(day);
   assert.equal(report.customers.length,3);
   assert.equal(report.totals.lots,3);
   for(const c of report.customers){
     assert.equal(c.lots.length,1);
     assert.ok(c.lots.every(l=>l.shippingDate===day));
     assert.equal(c.logisticsPending.length,2);
     assert.ok(c.logisticsPending.every(p=>p.shippingDate===day));
   }
 }
 const report=await load('all');
 assert.equal(report.customers.length,3);assert.equal(report.totals.lots,9);
 for(const c of report.customers){
   assert.equal(c.lots.length,3);assert.equal(c.logisticsPending.length,6);
   assert.equal(new Set(c.lots.map(l=>l.id)).size,3);
   assert.equal(new Set(c.logisticsPending.map(p=>p.id)).size,6);
   assert.equal(new Set(c.lots.map(l=>l.shippingDate)).size,3);
 }
 assert.equal(report.customers.find(c=>c.customerId==='cleber').storeOrders.length,1);
 assert.equal(report.customers.find(c=>c.customerId==='cleber').storeOrders[0].shippingDate,'2026-11-17');
 assert.equal((await load('2026-11-12')).customers.length,0);
});
