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
const scope = load('src/lib/dashboard-scope.ts', { '@/lib/freight': load('src/lib/freight.ts') });
const scopeServer = load('src/lib/dashboard-scope-server.ts', { 'server-only': {} });
function statsFor(lots, from, to, extra = {}) {
  const tables = { lots, ...extra };
  const client = { from(table) {
    let rows = [...(tables[table] || [])];
    const query = {
      select() { return this; },
      in(key, values) { rows = rows.filter(row => values.includes(row[key])); return this; },
      order() { return this; },
      range(start, end) { rows = rows.slice(start, end + 1); return this; },
      then(resolve) { return Promise.resolve({ data: rows, error: null }).then(resolve); },
    };
    return query;
  } };
  return load('src/lib/analytics.ts', {
    'server-only': {}, 'next/cache': { unstable_cache: fn => fn },
    '@/lib/charges': { isChargeActive: charge => ['pending', 'in_process'].includes(charge.status) },
    '@/lib/dates': { ...dates, spToday: () => '2026-10-28' },
    '@/lib/auction-period': periods, '@/lib/dashboard-scope': scope,
    '@/lib/dashboard-scope-server': scopeServer,
    '@/lib/lots': { LOT_STATUS_LABELS: {} },
    '@/lib/supabase/admin': { createAdminClient: () => client },
  }).getDashboardStats('2026-10-27', from, to);
}
let nextLotId = 0;

const lot = (value, overrides = {}) => ({ id: 'lot-' + nextLotId++, charge_id: null, code: 'TEST', title: 'Teste', status: 'paid',
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

test('fechamento pagina todos os lotes, restringe pendências ao período e exige dono', async () => {
  const rows = Array.from({ length: 1005 }, (_, index) => ({
    ...lot(1, { created_at: '2026-10-28T03:29:59Z', paid_at: '2026-10-29T18:00:00Z' }),
    id: String(index), code: 'LOT' + index,
  }));
  rows.push({ ...lot(100, { created_at: '2026-10-28T03:30:00Z', status: 'pending_payment', paid_at: null }), id: 'out', code: 'OUT' });
  rows.push({ ...lot(500, { created_at: '2026-10-28T03:00:00Z', status: 'cancelled', paid_at: null }), id: 'cancel', code: 'CANCEL' });
  rows.push({ ...lot(25, { created_at: '2026-10-27T15:00:00Z', status: 'pending_payment', paid_at: null, charge_id: 'mixed' }), id: 'pending', code: 'PENDING' });
  let role = 'owner', reads = 0;
  const client = { from(table) {
    assert.ok(['lots', 'charges'].includes(table)); reads++;
    let filtered = table === 'lots' ? [...rows] : [{ id: 'mixed', status: 'pending', amount: 999, expires_at: null, customer: { name: 'Teste', phone_e164: '' } }], from = 0, to = Infinity;
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
    '@/lib/dashboard-scope-server': scopeServer,
    '@/lib/dates': dates, '@/lib/auction-period': periods,
    '@/lib/result': { rethrowIfRedirect: () => {} }, '@/lib/staff-payments': {},
    '@/lib/supabase/admin': { createAdminClient: () => client },
  }).getClosingDataAction;
  const result = await action('2026-10-27', { from: '2026-10-27T12:00', to: '2026-10-28T00:30' });
  assert.equal(result.ok, true);
  assert.equal(result.data.totalLots, 1006);
  assert.equal(result.data.registeredOn, 1030);
  assert.equal(result.data.receivedOn, 1005);
  assert.equal(result.data.pendingLots.length, 1);
  assert.equal(result.data.periodPendingTotal, 25);
  assert.equal(result.data.pendingCharges[0].amount, 25);
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


test('todas as KPIs seguem o leilão; mensal/acumulado não sofrem corte e Pix misto não vaza valores', async () => {
  const customer = (id, email = 'ok@example.com', created_at = '2026-10-01T15:00:00Z') => ({ id, name: id, email, created_at });
  const a = customer('a'), b = customer('b', null, '2026-10-28T03:00:00Z'), c = customer('c'), d = customer('d');
  const rows = [
    lot(40, { id: 'old', customer_id: 'a', customer: a, charge_id: 'mixed', created_at: '2026-10-27T10:00:00Z' }),
    lot(30, { id: 'a', customer_id: 'a', customer: a, charge_id: 'mixed', created_at: '2026-10-27T23:00:00Z', paid_at: '2026-10-29T18:00:00Z' }),
    lot(50, { id: 'b', customer_id: 'b', customer: b, charge_id: 'b', created_at: '2026-10-28T03:40:00Z', paid_at: '2026-10-29T18:00:00Z' }),
    lot(60, { id: 'c', customer_id: 'c', customer: c, charge_id: 'pending', created_at: '2026-10-28T03:59:59Z', status: 'pending_payment', paid_at: null }),
    lot(70, { id: 'outside-c', customer_id: 'c', customer: c, charge_id: 'pending', created_at: '2026-10-28T04:00:00Z', status: 'pending_payment', paid_at: null }),
    lot(10, { id: 'd', customer_id: 'd', customer: d, created_at: '2026-10-28T03:00:00Z', status: 'pending_payment', paid_at: null }),
    lot(999, { id: 'cancel', customer_id: 'cancel', created_at: '2026-10-28T03:00:00Z', status: 'cancelled', paid_at: null }),
    lot(100, { id: 'outside', customer_id: 'outside', customer: customer('outside', null), charge_id: 'outside', created_at: '2026-10-27T21:00:00Z' }),
  ];
  const extra = {
    charges: [
      { id: 'mixed', customer_id: 'a', status: 'approved', amount: 90, freight_amount: 20, paid_at: '2026-10-28T02:59:59Z' },
      { id: 'b', customer_id: 'b', status: 'approved', amount: 70, freight_amount: 20, paid_at: '2026-10-28T03:00:00Z' },
      { id: 'pending', customer_id: 'c', status: 'pending', amount: 150, freight_amount: 20, expires_at: null },
      { id: 'outside', customer_id: 'outside', status: 'approved', amount: 120, freight_amount: 20 },
    ],
    charge_freight_items: [
      { charge_id: 'mixed', customer_id: 'a', first_lot_id: 'old', freight_period: '2026-10-27', freight_amount: 20 },
      { charge_id: 'b', customer_id: 'b', first_lot_id: 'b', freight_period: '2026-10-27', freight_amount: 20 },
    ],
    shipment_lots: [
      { lot_id: 'b', shipment_id: 'selected', shipment: { id: 'selected', status: 'pending' } },
      { lot_id: 'outside', shipment_id: 'outside', shipment: { id: 'outside', status: 'delivered' } },
    ],
    shipment_freight_usage: [{ charge_id: 'b', customer_id: 'b', shipment_id: 'selected', shipment: { status: 'pending' } }],
  };
  const result = await statsFor(rows, '2026-10-27T20:00', '2026-10-28T01:00', extra);
  assert.equal(result.revenue.month, 220);
  assert.equal(result.revenue.total, 220);
  assert.equal(result.revenue.day, 150);
  assert.equal(result.revenue.ticket, 40);
  assert.equal(result.closing.receivedOn, 80);
  assert.equal(result.charges.openAmount, 70);
  assert.equal(result.charges.pendingLotsCount, 2);
  assert.equal(result.charges.openCount, 1);
  assert.equal(result.charges.recentCreated, 3);
  assert.equal(result.charges.recentApproved, 2);
  assert.equal(result.customers.total, 4);
  assert.equal(result.customers.withoutEmail, 1);
  assert.equal(result.customers.newInPeriod, 1);
  assert.equal(result.shipments.toShip, 1);
  assert.equal(result.shipments.delivered, 0);
  assert.equal(result.pipeline.find(row => row.status === 'pending_payment').count, 2);
  assert.equal(result.ranking.length, 2);
  assert.equal(result.recentPayments.length, 2);
  assert.equal(result.revenue.months.at(-1).value, 80);
  assert.equal(result.freight.total, 20);
  assert.equal(result.freight.paidCount, 1);
  assert.equal(result.freight.carriedCount, 1);
  assert.equal(result.freight.pendingCount, 2);
  assert.equal(result.freight.byDay.qua, 20);
  assert.equal(result.freight.byDay.ter, 0);
  const other = await statsFor(rows, '2026-10-27T00:00', '2026-10-27T12:00', extra);
  assert.equal(other.revenue.month, 220);
  assert.equal(other.revenue.total, 220);
  assert.equal(other.revenue.day, 40);
  assert.equal(other.freight.total, 20);
  assert.equal(other.freight.byDay.ter, 20);
  assert.equal(other.freight.byDay.qua, 0);
  const empty = await statsFor(rows, '2026-10-26T00:00', '2026-10-26T12:00', extra);
  assert.equal(empty.revenue.total, 220);
  assert.equal(empty.customers.total, 0);
  assert.equal(empty.charges.openAmount, 0);
  assert.equal(empty.freight.total, 0);
  assert.equal(empty.freight.pendingCount, 0);
  assert.equal(empty.recentPayments.length, 0);
});

test('frete já usado no envio do período não vira pendente por lote novo de outro leilão', () => {
  const old = lot(40, { id: 'old', customer_id: 'a', charge_id: 'paid' });
  const newer = lot(50, { id: 'new', customer_id: 'a', status: 'pending_payment', paid_at: null });
  const result = scope.computePeriodFreight([old,newer], [old],
    [{ id: 'paid', customer_id: 'a', status: 'approved', freight_amount: 20 }],
    [{ lot_id: 'old', shipment_id: 'old-shipment', shipment: { id: 'old-shipment', status: 'delivered' } }],
    [{ charge_id: 'paid', shipment_id: 'old-shipment', shipment: { status: 'delivered' } }],
    [{ charge_id: 'paid', first_lot_id: 'old', freight_period: '2026-10-27', freight_amount: 20 }],
  );
  assert.equal(result.pendingCount, 0);
  assert.equal(result.total, 20);
});

test('consultas do escopo dividem IDs e paginam sem duplicar ou truncar dados', async () => {
  const ids = Array.from({ length: 115 }, (_, index) => 'customer-' + index);
  const rows = Array.from({ length: 601 }, (_, index) => ({ id: 'charge-' + index, customer_id: ids[0] }));
  for (const id of ids.slice(1)) rows.push({ id, customer_id: id });
  let requests = 0;
  const db = { from() {
    let selected = rows;
    return {
      select() { return this; },
      in(key, values) { assert.ok(values.length <= 100); selected = rows.filter(row => values.includes(row[key])); return this; },
      order() { return this; },
      async range(start, end) { requests++; return { data: selected.slice(start, end + 1), error: null }; },
    };
  } };
  const result = await scopeServer.fetchScopeRows(db, 'charges', 'customer_id', [...ids, ...ids], 'id');
  assert.equal(result.data.length, 715);
  assert.equal(new Set(result.data.map(row => row.id)).size, 715);
  assert.equal(requests, 3);
  await scopeServer.fetchScopeRows(db, 'charges', 'customer_id', [], 'id');
  assert.equal(requests, 3);
});

test('fechamento e frete têm identidades distintas ao trocar o período', () => {
  const path = 'src/app/(admin)/admin/dashboard/page.tsx';
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const printer = ts.createPrinter();
  const groups = [];
  function visit(node) {
    if (ts.isJsxElement(node)) {
      const cards = node.children.filter(child => ts.isJsxSelfClosingElement(child)
        && ['ClosingCard','FreightPeriodCard'].includes(child.tagName.getText(source)));
      if (cards.length) groups.push(cards);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 2);
  const expressions = groups[0].map(card => {
    const key = card.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'key');
    assert.ok(key?.initializer && ts.isJsxExpression(key.initializer) && key.initializer.expression);
    return printer.printNode(ts.EmitHint.Expression, key.initializer.expression, source);
  });
  const periods = [
    { from: '2026-10-27T00:00', to: '2026-10-28T01:00' },
    { from: '2026-10-28T00:00', to: '2026-10-29T00:00' },
  ];
  const identities = periods.map(period => expressions.map(expression => vm.runInNewContext(expression, { period })));
  for (const keys of identities) assert.equal(new Set(keys).size, 2, 'componentes irmãos não podem compartilhar a mesma chave');
  assert.notEqual(identities[0][0], identities[1][0], 'fechamento deve reiniciar ao trocar de período');
  assert.notEqual(identities[0][1], identities[1][1], 'filtro do frete deve reiniciar ao trocar de período');
});
