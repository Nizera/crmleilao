import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const customer = id => ({ id, name: 'Cliente teste', phone_e164: '+5511000000000' });
const lot = (id, customerId, status = 'paid') => ({ id, code: id, title: 'Figurinha teste', status, shipping_date: '2026-11-03', created_at: '2026-10-29T12:00:00Z', customers: customer(customerId), customer_id: customerId, moved_at: null });

function reportLoader({ missing = true, queryError, lots = [], issues = [], freightError = false, freight = [] } = {}) {
  const calls = [];
  const db = { from(table) {
    const call = { table, select: '' };
    calls.push(call);
    let rows = [...({ lots, logistics_pending: issues, charges: [], lot_items: [] }[table] ?? [])];
    const field = (row, key) => key.split('.').reduce((value, part) => value?.[part], row);
    return {
      select(value) { call.select = value; return this; },
      eq(key, value) { rows = rows.filter(row => field(row,key) === value); return this; },
      neq(key, value) { rows = rows.filter(row => field(row,key) !== value); return this; },
      lte(key, value) { rows = rows.filter(row => field(row,key) <= value); return this; },
      is(key, value) { rows = rows.filter(row => (field(row,key) ?? null) === value); return this; },
      in(key, values) { rows = rows.filter(row => values.includes(field(row,key))); return this; },
      order() { return this; },
      range(from, to) { rows = rows.slice(from,to+1); return this; },
      then(resolve) {
        const error = table === 'logistics_pending' ? queryError ?? (missing ? { code: 'PGRST205' } : null) : null;
        return Promise.resolve({ data: error ? null : rows, error }).then(resolve);
      },
    };
  }, async rpc(name) {
    return name === 'shipping_freight_states' ? { data: freight, error: freightError ? { message: 'unavailable' } : null } : { data: [], error: null };
  } };
  const exports = {};
  const dependencies = {
    'server-only': {}, '@/lib/notes': { loadNotes: async () => new Map() },
    '@/lib/supabase/admin': { createAdminClient: () => db },
    '@/lib/supabase/server': { createClient: async () => db },
    '@/lib/charges': { isChargeActive: charge => ['pending','in_process'].includes(charge.status) },
  };
  const source = ts.transpileModule(readFileSync('src/lib/reports-server.ts','utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, require: name => { if (!(name in dependencies)) throw new Error(name); return dependencies[name]; } });
  return { load: () => exports.getSeparationReport('2026-11-03'), calls };
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
  await assert.rejects(reportLoader({ lots: [lot('paid','a')], freightError: true }).load(), /pagamentos de frete/);
});

test('Com migration, reposições e lotes são agrupados no mesmo cliente sem aviso', async () => {
  const issue = { id: 'issue', code: 'PEN-TESTE', title: 'Reposição', quantity: 1, reason: 'Item faltante', shipping_date: '2026-11-03', cancelled_at: null, shipment_id: null, moved_at: null, customers: customer('a') };
  const report = await reportLoader({ missing: false, lots: [lot('paid','a')], issues: [issue], freight: [{ customer_id: 'a', status: 'paid' }] }).load();
  assert.equal(report.warnings.length,0);
  assert.equal(report.customers.length,1);
  assert.equal(report.customers[0].lots.length,1);
  assert.equal(report.customers[0].logisticsPending[0].code,'PEN-TESTE');
});
