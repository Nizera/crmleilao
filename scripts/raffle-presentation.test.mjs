import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = ts.transpileModule(fs.readFileSync('src/lib/raffle-presentation.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { summarizeRaffleCampaigns, raffleAwardStage } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
test('indicadores não confundem cancelamento, reserva e pagamento confirmado', () => {
  const order = { campaign_id: 'campaign', amount: 19.99, numbers: [0, 1], created_at: '2026-11-01', paid_at: null };
  const stats = summarizeRaffleCampaigns([{ ...order, status: 'paid' }, { ...order, status: 'pending' }, { ...order, status: 'cancelled' }, { ...order, status: 'expired' }, { ...order, status: 'review', numbers: [2] }, { ...order, campaign_id: 'other', status: 'paid', amount: 0.1, numbers: [3] }, { ...order, campaign_id: 'other', status: 'paid', amount: 0.2, numbers: [4] }], [{ campaign_id: 'campaign', kind: 'instant' }, { campaign_id: 'campaign', kind: 'main' }]);
  assert.deepEqual(stats.campaign, { paid: 2, reserved: 3, received: 19.99, instantPrizes: 1 });
  assert.equal(stats.other.received, 0.3);
});
test('prêmio em análise ou etiqueta cancelada não aparecem como entrega concluída', () => {
  assert.equal(raffleAwardStage({ order_status: 'review', shipment_status: 'delivered' }).index, -1);
  assert.equal(raffleAwardStage({ cancelled_at: '2026-11-01', order_status: 'paid' }).index, -1);
  assert.equal(raffleAwardStage({ order_status: 'paid', moved_at: '2026-11-01', shipment_id: 'old', shipment_status: 'cancelled' }).index, 1);
  assert.equal(raffleAwardStage({ order_status: 'paid' }).index, 0);
  assert.equal(raffleAwardStage({ order_status: 'paid', shipment_id: 'new', shipment_status: 'pending' }).index, 2);
  assert.equal(raffleAwardStage({ order_status: 'paid', shipment_id: 'new', shipment_status: 'delivered' }).index, 3);
});
