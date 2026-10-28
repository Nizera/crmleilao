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
const periods = load('src/lib/auction-period.ts', { '@/lib/dates': dates });
function statsFor(lots, from, to) {
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
    '@/lib/auction-period': periods,
    '@/lib/lots': { LOT_STATUS_LABELS: {} },
    '@/lib/supabase/admin': { createAdminClient: () => client },
  }).getDashboardStats('2026-10-27', from, to);
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
  assert.equal(result.closing.receivedOn, 40);
});

test('leilão atravessa meia-noite e recebimento posterior continua no fechamento correto', async () => {
  const result = await statsFor([
    lot(10, { created_at: '2026-10-27T14:59:59Z' }),
    lot(30, { created_at: '2026-10-27T15:00:00Z', paid_at: '2026-10-29T18:00:00Z' }),
    lot(50, { created_at: '2026-10-28T03:29:59Z', paid_at: null, status: 'pending_payment' }),
    lot(80, { created_at: '2026-10-28T03:30:00Z' }),
  ], '2026-10-27T12:00', '2026-10-28T00:30');
  assert.equal(result.revenue.dayLots, 2);
  assert.equal(result.revenue.day, 80);
  assert.equal(result.closing.receivedOn, 30);
  assert.equal(result.closing.paidLotsOn, 1);
});

test('datas/horas SP, intervalos adjacentes e limites inválidos', () => {
  const period = periods.resolveAuctionPeriod('2026-10-28', { from: '2026-10-28T12:00', to: '2026-10-29T00:30' });
  assert.equal(period.startUtc, '2026-10-28T15:00:00.000Z');
  assert.equal(period.endUtc, '2026-10-29T03:30:00.000Z');
  assert.equal(periods.isInAuctionPeriod(period.endUtc, period), false);
  const next = periods.resolveAuctionPeriod(undefined, { from: period.to, to: '2026-10-29T12:00' });
  assert.equal(periods.isInAuctionPeriod(period.endUtc, next), true);
  for (const input of [
    { from: '2026-02-30T12:00', to: '2026-03-01T12:00' },
    { from: '2026-10-28T25:00', to: '2026-10-29T12:00' },
    { from: '2026-10-28T12:60', to: '2026-10-29T12:00' },
    { from: '2026-10-29T12:00', to: '2026-10-28T12:00' },
    { from: '2026-10-28T12:00', to: '2026-10-28T12:00' },
    { from: '2026-10-28T12:00', to: '2027-01-01T12:00' },
    { from: '2026-10-28T12:00' },
  ]) assert.throws(() => periods.resolveAuctionPeriod(undefined, input));
});

test('fechamento pagina todos os lotes, mantém pendências gerais e exige dono', async () => {
  const rows = Array.from({ length: 1005 }, (_, index) => ({
    ...lot(1, { created_at: '2026-10-28T03:29:59Z', paid_at: '2026-10-29T18:00:00Z' }),
    id: String(index), code: 'LOT' + index,
  }));
  rows.push({ ...lot(100, { created_at: '2026-10-28T03:30:00Z', status: 'pending_payment', paid_at: null }), id: 'out', code: 'OUT' });
  rows.push({ ...lot(500, { created_at: '2026-10-28T03:00:00Z', status: 'cancelled', paid_at: null }), id: 'cancel', code: 'CANCEL' });
  let role = 'owner', reads = 0;
  const client = { from(table) {
    assert.ok(['lots', 'charges'].includes(table)); reads++;
    let filtered = table === 'lots' ? [...rows] : [], from = 0, to = Infinity;
    const query = {
      select() { return this; },
      eq(key, value) { filtered = filtered.filter(row => row[key] === value); return this; },
      in(key, values) { filtered = filtered.filter(row => values.includes(row[key])); return this; },
      neq(key, value) { filtered = filtered.filter(row => row[key] !== value); return this; },
      gte(key, value) { filtered = filtered.filter(row => Date.parse(row[key]) >= Date.parse(value)); return this; },
      lt(key, value) { filtered = filtered.filter(row => Date.parse(row[key]) < Date.parse(value)); return this; },
      order() { return this; },
      range(start, end) { from = start; to = end; return this; },
      then(resolve) { return Promise.resolve({ data: filtered.slice(from, to + 1), error: null }).then(resolve); },
    };
    return query;
  } };
  const action = load('src/app/actions/staff-payments.ts', {
    'next/cache': {}, '@/lib/dal': { requireAdmin: async () => ({ profile: { role } }) },
    '@/lib/charges': { isChargeActive: () => true },
    '@/lib/dates': dates, '@/lib/auction-period': periods,
    '@/lib/result': { rethrowIfRedirect: () => {} }, '@/lib/staff-payments': {},
    '@/lib/supabase/admin': { createAdminClient: () => client },
  }).getClosingDataAction;
  const result = await action('2026-10-27', { from: '2026-10-27T12:00', to: '2026-10-28T00:30' });
  assert.equal(result.ok, true);
  assert.equal(result.data.totalLots, 1005);
  assert.equal(result.data.registeredOn, 1005);
  assert.equal(result.data.receivedOn, 1005);
  assert.equal(result.data.pendingLots.length, 1);
  assert.equal(result.data.periodPendingTotal, 0);
  assert.equal('staff' in result.data, false);
  role = 'viewer'; reads = 0;
  assert.equal((await action()).ok, false);
  assert.equal(reads, 0);
});

test('frete não cria pendência para cancelados ou crédito de pacote acumulado', async () => {
  let allPaid = false;
  const candidates = [
    { customer_id: 'paid-current', status: 'paid' },
    { customer_id: 'paid-old-credit', status: 'paid' },
    { customer_id: 'cancelled-only', status: 'cancelled' },
    { customer_id: 'due', status: 'paid' },
    { customer_id: 'awaiting', status: 'pending_payment' },
    { customer_id: 'paid-current', status: 'paid' },
  ];
  const client = {
    from(table) {
      let rows = table === 'lots' ? candidates : [
        { customer_id: 'paid-current', freight_amount: 20, paid_at: '2026-10-27T15:00:00Z' },
      ];
      const query = new Proxy({}, { get: (_, key) => {
        if (key === 'then') return resolve => Promise.resolve({ data: rows, error: null }).then(resolve);
        if (key === 'neq') return (column, value) => { rows = rows.filter(row => row[column] !== value); return query; };
        return () => query;
      } });
      return query;
    },
    async rpc(name, args) {
      assert.equal(name, 'shipping_freight_states');
      assert.deepEqual([...args.p_customers].sort(), ['awaiting','due','paid-current','paid-old-credit']);
      return { data: args.p_customers.map(customer_id => ({
        customer_id, status: !allPaid && ['due','awaiting'].includes(customer_id) ? customer_id : 'paid',
      })), error: null };
    },
  };
  const freight = load('src/lib/freight-server.ts', {
    'server-only': {},
    '@/lib/supabase/admin': { createAdminClient: () => client },
    '@/lib/freight': {
      freightPeriodStart: () => '2026-10-27', freightPeriodEnd: () => '2026-11-03',
      spWeekdayKey: () => 'ter',
    },
  });
  const result = await freight.getFreightWeekStats();
  assert.equal(result.pendingCount, 2);
  assert.equal(result.total, 20);
  assert.equal(result.paidCount, 1);
  allPaid = true;
  assert.equal((await freight.getFreightWeekStats()).pendingCount, 0);
});
