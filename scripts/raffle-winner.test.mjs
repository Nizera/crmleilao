import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

test('consulta de ganhador exige equipe, filtra campanha/cota paga e não retorna contatos', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  let role = 'viewer', queries = 0, allowed = true, result = { data: { id: 'order', customer: { name: 'Cliente fixture' } }, error: null };
  const filters = {};
  const db = { from(table) { queries++; assert.equal(table, 'raffle_orders'); return {
    select(columns) { assert.equal(columns, 'id,customer:customers(name)'); return this; },
    eq(key, value) { filters[key] = value; return this; },
    contains(key, value) { filters[key] = value; return this; },
    maybeSingle: async () => result,
  }; } };
  const deps = { zod: require('zod'), '@/lib/dal': { requireAdmin: async () => ({ profile: { role, id } }) }, '@/lib/supabase/server': { createClient: async () => db }, '@/lib/ratelimit': { allow: async () => allowed }, '@/lib/result': { rethrowIfRedirect: () => {} } };
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync('src/app/actions/raffles.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, process, require: name => deps[name] ?? {} });
  const lookup = exports.lookupRaffleBuyer;
  assert.equal((await lookup(id, 0)).ok, false); assert.equal(queries, 0);
  role = 'staff';
  for (const n of [-1, 0.5, 10000, NaN]) assert.equal((await lookup(id, n)).ok, false);
  assert.equal((await lookup('invalid', 0)).ok, false); assert.equal(queries, 0);
  allowed = false; assert.equal((await lookup(id, 0)).ok, false); assert.equal(queries, 0); allowed = true;
  const winner = await lookup(id, Number('000'));
  assert.equal(winner.data.number, 0); assert.equal(winner.data.name, 'Cliente fixture');
  assert.equal(filters.campaign_id, id); assert.equal(filters.status, 'paid'); assert.equal(filters.numbers[0], 0);
  assert.deepEqual(Object.keys(winner.data).sort(), ['name', 'number']);
  await lookup(id, Number('001')); assert.equal(filters.numbers[0], 1);
  result = { data: null, error: null }; assert.equal((await lookup(id, 2)).data, null);
  result = { data: null, error: { message: 'private database error' } };
  const failure = await lookup(id, 2); assert.equal(failure.ok, false); assert.ok(!failure.error.includes('private database'));
});
