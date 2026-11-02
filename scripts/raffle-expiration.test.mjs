import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as crypto from 'node:crypto';
function load(path, deps = {}, extra = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, Date, AbortSignal, Response, process: { env: {} }, require: n => deps[n] ?? {}, ...extra });
  return exports;
}
const reservation = load('src/lib/raffle-reservation.ts');
test('prazo usa relógio do servidor e não é prorrogado pela validade do Pix', () => {
  const created_at = '2026-11-02T12:00:00Z';
  assert.equal(reservation.raffleReservationDeadline({ created_at }), '2026-11-02T12:10:00.000Z');
  assert.equal(reservation.raffleReservationExpired({ created_at }, Date.parse('2026-11-02T12:09:59Z')), false);
  assert.equal(reservation.raffleReservationExpired({ created_at }, Date.parse('2026-11-02T12:10:00Z')), true);
  assert.equal(reservation.raffleReservationDeadline({ created_at, reservation_expires_at: '2026-11-02T12:11:00Z' }), '2026-11-02T12:11:00Z');
});
test('fim da reserva cancela no provedor e só liquida uma resposta autenticada e compatível', async () => {
  let replies, cancelled, statuses;
  const pending = { id: 'ORD_fixture', externalReference: 'raffle_fixture', amount: 10, status: 'action_required', statusDetail: 'waiting_transfer', raw: {} };
  const provider = {
    getOrder: async () => replies.shift(),
    cancelPixOrder: async () => { cancelled++; return false; },
    targetChargeStatus: s => ({ processed: 'approved', canceled: 'cancelled', expired: 'expired' })[s] ?? null,
    qrFrom: () => ({}),
  };
  const { syncRafflePayment } = load('src/lib/raffles-server.ts', {
    '@/lib/mercadopago': provider, '@/lib/raffle-reservation': reservation,
    '@/lib/supabase/admin': { createAdminClient: () => ({ rpc: async (_name, args) => { statuses.push(args.p_status); return {}; } }) },
  });
  const order = { id: 'local', mp_order_id: pending.id, external_reference: pending.externalReference, amount: 10, created_at: '2026-01-01T00:00:00Z' };
  const run = async values => { replies = values; cancelled = 0; statuses = []; await syncRafflePayment(order); };
  await run([pending, { ...pending, status: 'canceled' }]); assert.equal(cancelled, 1); assert.deepEqual(statuses, ['cancelled']);
  await run([pending, pending]); assert.equal(cancelled, 1); assert.deepEqual(statuses, []);
  await run([{ ...pending, status: 'processed' }]); assert.equal(cancelled, 0); assert.deepEqual(statuses, ['paid']);
  await run([pending, { ...pending, status: 'processed' }]); assert.deepEqual(statuses, ['paid']);
  replies = [pending, null]; cancelled = 0; statuses = []; await assert.rejects(syncRafflePayment(order), /não confirmado/); assert.deepEqual(statuses, []);
  replies = [{ ...pending, amount: 11 }]; cancelled = 0; statuses = []; await assert.rejects(syncRafflePayment(order), /divergente/); assert.equal(cancelled, 0);
});
test('agendamento exige segredo correto antes de consultar ou cancelar pagamentos', async () => {
  let runs = 0;
  const env = { CRON_SECRET: 'fixture-only-secret' };
  const { GET } = load('src/app/api/cron/raffle-expiration/route.ts', {
    'node:crypto': crypto, 'next/cache': { revalidatePath() {} },
    '@/lib/raffles-server': { reconcileRafflePayments: async () => { runs++; return { checked: 1, failed: 0 }; } },
  }, { process: { env } });
  assert.equal((await GET(new Request('https://example.invalid'))).status, 401);
  assert.equal((await GET(new Request('https://example.invalid', { headers: { authorization: 'Bearer wrong' } }))).status, 401);
  assert.equal(runs, 0);
  assert.equal((await GET(new Request('https://example.invalid', { headers: { authorization: `Bearer ${env.CRON_SECRET}` } }))).status, 200);
  assert.equal(runs, 1);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = time => crypto.createHmac('sha256', env.CRON_SECRET).update(`raffle-expiration:${time}`).digest('hex');
  const signed = (time, token = signature(time)) => new Request('https://example.invalid', { headers: { authorization: `Bearer ${token}`, 'x-raffle-cron-time': time } });
  assert.equal((await GET(signed(timestamp))).status, 200);
  assert.equal(runs, 2);
  for (const time of [String(Number(timestamp) - 120), String(Number(timestamp) + 120), 'invalid']) assert.equal((await GET(signed(time))).status, 401);
  assert.equal((await GET(signed(timestamp, 'invalid'))).status, 401);
  assert.equal(runs, 2);
});
