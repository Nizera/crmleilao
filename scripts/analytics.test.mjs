import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(path, dependencies = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports, console, require: name => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  } });
  return exports;
}

const dates = load('src/lib/dates.ts');
function statsFor(lots) {
  const client = { from(table) {
    const result = { data: table === 'lots' ? lots : [], count: 0, error: null };
    const query = new Proxy({}, { get: (_, key) => key === 'then'
      ? (resolve => Promise.resolve(result).then(resolve))
      : (() => query) });
    return query;
  } };
  return load('src/lib/analytics.ts', {
    'server-only': {},
    'next/cache': { unstable_cache: fn => fn },
    '@/lib/charges': { isChargeActive: () => false },
    '@/lib/dates': dates,
    '@/lib/lots': { LOT_STATUS_LABELS: {} },
    '@/lib/supabase/admin': { createAdminClient: () => client },
  }).getDashboardStats('2026-10-27');
}

const lot = (value, overrides = {}) => ({ code: 'TEST', title: 'Teste', status: 'paid',
  arremate_value: value, paid_at: '2026-10-27T18:00:00Z',
  created_at: '2026-10-27T15:00:00Z', shipping_date: null,
  customer_id: 'customer', customer: { id: 'customer', name: 'Teste' }, ...overrides });

test('8 lotes de R$ 925 entram uma única vez no faturamento diário', async () => {
  const result = await statsFor([100,100,100,100,100,100,100,225].map(value => lot(value)));
  assert.equal(result.revenue.dayLots, 8);
  assert.equal(result.revenue.day, 925);
  assert.equal(result.closing.receivedOn, 925);
  assert.equal(result.ranking[0].lots, 8);
});

test('dia de São Paulo inclui pendentes, exclui cancelados e separa recebimento', async () => {
  const result = await statsFor([
    lot(30, { status: 'pending_payment', paid_at: null }),
    lot(40, { created_at: '2026-10-28T02:59:59Z' }),
    lot(99, { status: 'cancelled' }),
    lot(100, { created_at: '2026-10-28T03:00:00Z', paid_at: null, status: 'pending_payment' }),
    lot(20, { created_at: '2026-10-27T02:59:59Z' }),
  ]);
  assert.equal(result.revenue.dayLots, 2);
  assert.equal(result.revenue.day, 70);
  assert.equal(result.closing.receivedOn, 60);
});
