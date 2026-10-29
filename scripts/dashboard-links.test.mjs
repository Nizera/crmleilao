import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';
import { PGlite } from '@electric-sql/pglite';

function compile(source, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, ...dependencies });
  return exports;
}
const filters = compile(readFileSync('src/lib/admin-list-filters.ts', 'utf8'), { URLSearchParams });
const sorting = compile(readFileSync('src/lib/lot-sort.ts', 'utf8'));
const source = ts.createSourceFile('dal.ts', readFileSync('src/lib/dal.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const selected = source.statements.filter(node => ts.isFunctionDeclaration(node) && ['listCustomersPage', 'listLotsPage', 'listCharges'].includes(node.name?.text));
const dalSource = selected.map(node => node.getText(source)).join('\n');
function databaseQueries() {
  const requests = [];
  const db = createClient('https://fixture.invalid', 'fixture-key', { auth: { persistSession: false, autoRefreshToken: false }, global: {
    fetch: async (input, init) => {
      requests.push({ url: new URL(String(input)), headers: new Headers(init.headers) });
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json', 'content-range': '0-0/0' } });
    },
  } });
  const dal = compile(dalSource, {
    createClient: async () => db, loadNotes: async () => new Map(),
    CUSTOMER_COLUMNS: 'id,name,email', CHARGE_LIST_COLUMNS: 'id,lots:lots(id)', CUSTOMER_MATCH_CAP: 300,
    lotColumns: () => 'id,created_at', customerIssueExpression: filters.customerIssueExpression,
    LOT_SORTS: sorting.LOT_SORTS, normalizeLotSort: sorting.normalizeLotSort,
  });
  return { dal, requests };
}
const period = { from: '2026-10-27T20:00', to: '2026-10-28T01:00' };
const utc = { start: '2026-10-27T23:00:00.000Z', end: '2026-10-28T04:00:00.000Z' };

test('Atalhos levam à lista correspondente, com o mesmo período e filtro específico', () => {
  const links = filters.dashboardPendingLinks(period, '2026-11-03');
  for (const link of Object.values(links)) {
    const url = new URL(link, 'https://fixture.invalid');
    assert.equal(url.searchParams.get('from'), period.from);
    assert.equal(url.searchParams.get('to'), period.to);
    assert.equal(url.searchParams.has('p'), false);
  }
  assert.equal(new URL(links.lots, 'https://fixture.invalid').pathname, '/admin/lotes');
  assert.equal(new URL(links.lots, 'https://fixture.invalid').searchParams.get('status'), 'pending_payment');
  assert.equal(new URL(links.customers, 'https://fixture.invalid').searchParams.get('issue'), 'without_email');
  assert.equal(new URL(links.expiring, 'https://fixture.invalid').searchParams.get('expiring'), '24h');
  assert.equal(new URL(links.shipping, 'https://fixture.invalid').searchParams.get('shipping'), '2026-11-03');
});

test('Clientes: busca E pendência E lotes do período antes da paginação no banco', async () => {
  const { dal, requests } = databaseQueries();
  await dal.listCustomersPage({ q: 'Maria', issue: 'without_email', page: 2, lotStartUtc: utc.start, lotEndUtc: utc.end });
  const { url, headers } = requests[0];
  assert.ok(url.searchParams.get('select').includes('scope_lots:lots!inner()'));
  assert.equal(url.searchParams.get('scope_lots.created_at'), 'gte.' + utc.start);
  assert.deepEqual(url.searchParams.getAll('scope_lots.created_at'), ['gte.' + utc.start, 'lt.' + utc.end]);
  assert.equal(url.searchParams.get('scope_lots.status'), 'neq.cancelled');
  const clauses = url.searchParams.getAll('or');
  assert.equal(clauses.length, 2);
  assert.ok(clauses.some(value => value.includes('name.ilike.%Maria%')));
  assert.ok(clauses.some(value => value.includes('email.match.')));
  assert.equal(url.searchParams.get('offset'), '10');
  assert.equal(url.searchParams.get('limit'), '10');
  assert.ok(headers.get('prefer').includes('count=exact'));
});

test('Lotes: pagamento e postagem combinam com cadastro; cobranças: vencimento não usa data de criação do Pix', async () => {
  const { dal, requests } = databaseQueries();
  await dal.listLotsPage({ status: 'pending_payment', startUtc: utc.start, endUtc: utc.end });
  assert.equal(requests[0].url.searchParams.get('status'), 'eq.pending_payment');
  assert.deepEqual(requests[0].url.searchParams.getAll('created_at'), ['gte.' + utc.start, 'lt.' + utc.end]);
  await dal.listLotsPage({ status: 'paid', shippingDate: '2026-11-03', startUtc: utc.start, endUtc: utc.end });
  assert.equal(requests[1].url.searchParams.get('shipping_date'), 'eq.2026-11-03');
  await dal.listCharges({ expiring24h: true, lotStartUtc: utc.start, lotEndUtc: utc.end });
  const url = requests[2].url;
  assert.equal(url.searchParams.get('status'), 'in.(pending,in_process)');
  assert.deepEqual(url.searchParams.getAll('scope_lots.created_at'), ['gte.' + utc.start, 'lt.' + utc.end]);
  const [lower, upper] = url.searchParams.getAll('expires_at');
  assert.equal(Date.parse(upper.slice(3)) - Date.parse(lower.slice(4)), 86_400_000);
  assert.equal(url.searchParams.has('created_at'), false);
});

test('Sem e-mail inclui NULL/vazio/espaços; cliente com vários lotes é contado uma vez e fora do período não entra', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table customers(id integer,email text); create table lots(customer_id integer,created_at timestamptz,status text);
      insert into customers values(1,null),(2,''),(3,'   '),(4,'cliente@example.invalid'),(5,null);
      insert into lots values(1,'2026-10-28T00:00Z','paid'),(1,'2026-10-28T01:00Z','pending_payment'),
        (2,'2026-10-28T00:00Z','paid'),(3,'2026-10-28T00:00Z','paid'),(5,'2026-10-27T10:00Z','paid');`);
    const pattern = filters.customerIssueExpression('without_email').split('.match.')[1];
    const result = await db.query(`select c.id from customers c where(c.email is null or c.email ~ $1) and exists(
      select 1 from lots l where l.customer_id=c.id and l.created_at >= $2 and l.created_at < $3 and l.status<>'cancelled') order by c.id`, [pattern, utc.start, utc.end]);
    assert.deepEqual(result.rows.map(row => row.id), [1,2,3]);
  } finally { await db.close(); }
});

test('Ordenação de lotes é aplicada no banco antes de paginar, mantém filtros e usa desempate estável', async () => {
  for (const [sort, column, direction] of [
    ['customer_asc','customer(name)','asc'], ['phone_desc','customer(phone_e164)','desc'],
    ['oldest','created_at','asc'], ['value_desc','arremate_value','desc'], ['shipping_asc','shipping_date','asc'],
  ]) {
    const { dal, requests } = databaseQueries();
    await dal.listLotsPage({ sort, page: 3, status: 'paid', shippingDate: '2026-11-03', startUtc: utc.start, endUtc: utc.end });
    const url = requests[0].url;
    assert.ok(url.searchParams.get('order').startsWith(`${column}.${direction}.nullslast`));
    assert.ok(url.searchParams.get('order').endsWith('id.desc'));
    assert.equal(url.searchParams.get('offset'),'50');
    assert.equal(url.searchParams.get('limit'),'25');
    assert.equal(url.searchParams.get('status'),'eq.paid');
    assert.equal(url.searchParams.get('shipping_date'),'eq.2026-11-03');
    assert.deepEqual(url.searchParams.getAll('created_at'),['gte.'+utc.start,'lt.'+utc.end]);
  }
});

test('Ordenação desconhecida ou manipulada volta para cadastro mais recente', async () => {
  for (const sort of ['__proto__','customer(name).desc,arremate_value','invalid',undefined]) {
    assert.equal(sorting.normalizeLotSort(sort),'newest');
    const { dal, requests } = databaseQueries();
    await dal.listLotsPage({ sort });
    assert.equal(requests[0].url.searchParams.get('order'),'created_at.desc.nullslast,id.desc');
  }
});
