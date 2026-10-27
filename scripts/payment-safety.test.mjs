import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, dependencies) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, console, require(name) {
    if (!(name in dependencies)) throw Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  } });
  return exports;
}

function fixture({ states = ['created', 'canceled'], reference = 'REF', noOrder = false, unlinkFails = false } = {}) {
  const charge = { id: 'charge', code: 'PIX', customer_id: 'customer', amount: 70,
    status: 'pending', mp_payment_id: noOrder ? null : 'ORD123', external_reference: 'REF' };
  const lot = { id: 'lot', status: 'pending_payment', charge_id: 'charge' };
  let reads = 0, cancels = 0;
  const client = { from(table) {
    const filters = [];
    let patch;
    const execute = () => {
      const row = table === 'charges' ? charge : lot;
      const matches = filters.every(([key, values]) => values.includes(row[key]));
      if (patch && matches && table === 'lots' && unlinkFails) return { data: null, error: { message: 'offline' } };
      if (patch && matches) Object.assign(row, patch);
      return { data: patch ? (matches ? [{ ...row }] : []) : { ...row }, error: null };
    };
    const query = {
      select() { return this; }, update(value) { patch = value; return this; },
      eq(key, value) { filters.push([key, [value]]); return this; },
      in(key, values) { filters.push([key, values]); return this; },
      maybeSingle: async () => execute(),
      then(resolve) { return Promise.resolve(execute()).then(resolve); },
    };
    return query;
  } };
  const api = load('src/lib/charges-server.ts', {
    'server-only': {}, '@/lib/charges': { isChargeOpen: status => ['pending','in_process'].includes(status) },
    '@/lib/supabase/admin': { createAdminClient: () => client },
    '@/lib/lots': { formatBRL: String },
    '@/lib/notifications-server': { notifyCustomer: async () => {} },
    '@/lib/mercadopago': {
      async getOrder() {
        const status = states[Math.min(reads++, states.length - 1)];
        return status === null ? null : { id: 'ORD123', status, statusDetail: '', amount: 70, externalReference: reference };
      },
      cancelPixOrder: async () => { cancels++; return true; },
      targetChargeStatus: status => ({ processed: 'approved', canceled: 'cancelled', expired: 'expired' })[status] || null,
    },
  });
  return { api, charge, lot, cancels: () => cancels };
}

test('cancelamento só libera lotes após confirmação remota', async () => {
  const f = fixture();
  assert.equal((await f.api.cancelCharge('charge')).ok, true);
  assert.equal(f.cancels(), 1);
  assert.equal(f.charge.status, 'cancelled');
  assert.equal(f.lot.charge_id, null);
});

test('pagamento já confirmado e pagamento durante cancelamento são preservados', async () => {
  for (const states of [['processed'], ['created','processed']]) {
    const f = fixture({ states });
    assert.equal((await f.api.cancelCharge('charge')).reason, 'already_approved');
    assert.equal(f.charge.status, 'approved');
    assert.equal(f.lot.status, 'paid');
    assert.equal(f.lot.charge_id, 'charge');
  }
});

test('sem confirmação, ordem ou referência correta, mantém cobrança e vínculo', async () => {
  for (const options of [
    { states: ['created','created'] }, { states: ['created',null] },
    { states: [null] }, { states: ['processing'] }, { noOrder: true }, { reference: 'OTHER' },
  ]) {
    const f = fixture(options);
    assert.equal((await f.api.cancelCharge('charge')).ok, false);
    assert.equal(f.charge.status, 'pending');
    assert.equal(f.lot.charge_id, 'charge');
  }
});

test('falha de liberação deixa cancelamento recuperável', async () => {
  const f = fixture({ unlinkFails: true });
  await assert.rejects(f.api.cancelCharge('charge'), /liberar os lotes/);
  assert.equal(f.charge.status, 'pending');
  assert.equal(f.lot.charge_id, 'charge');
});

test('guarda de edição financeira bloqueia lotes pagos e exige cancelamento confirmado', async () => {
  let chargeStatus = 'pending', cancelled = false, accepted = true;
  const guard = load('src/lib/lot-payment-guard.ts', {
    'server-only': {}, '@/lib/charges-server': {
      getChargeById: async () => ({ id: 'charge', status: chargeStatus }),
      cancelCharge: async () => { cancelled = true; return { ok: accepted }; },
    },
  }).prepareLotFinancialChange;
  for (const status of ['paid','shipped','delivered']) {
    await assert.rejects(guard({ status, paid_at: null, charge_id: 'charge' }), /já foi pago/);
    assert.equal(cancelled, false);
  }
  const lot = { status: 'pending_payment', paid_at: null, charge_id: 'charge' };
  chargeStatus = 'approved';
  await assert.rejects(guard(lot), /já foi pago/);
  chargeStatus = 'pending'; accepted = false;
  await assert.rejects(guard(lot), /lote não foi alterado/);
  accepted = true;
  await guard(lot);
  assert.equal(cancelled, true);
  await guard({ ...lot, charge_id: null });
});
