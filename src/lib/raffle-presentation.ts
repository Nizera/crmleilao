export type RaffleSummary = { paid: number; reserved: number; received: number; instantPrizes: number };
export type RaffleSummaryOrder = { campaign_id: string; status: string; amount: number | string; numbers: number[]; created_at: string; paid_at: string | null };
export function summarizeRaffleCampaigns(orders: RaffleSummaryOrder[], prizes: { campaign_id: string; kind: string }[] = []): Record<string, RaffleSummary> {
  const result: Record<string, RaffleSummary> = {};
  const entry = (id: string) => result[id] ??= { paid: 0, reserved: 0, received: 0, instantPrizes: 0 };
  for (const order of orders) {
    const row = entry(order.campaign_id);
    if (order.status === "paid") { row.paid += order.numbers.length; row.received += Math.round(Number(order.amount) * 100); }
    else if (["creating", "pending", "review"].includes(order.status)) row.reserved += order.numbers.length;
  }
  for (const prize of prizes) if (prize.kind === "instant") entry(prize.campaign_id).instantPrizes++;
  for (const row of Object.values(result)) row.received /= 100;
  return result;
}
export function raffleAwardStage(award: { cancelled_at?: string | null; order_status?: string; shipment_status?: string | null; shipment_id?: string | null; moved_at?: string | null }) {
  if (award.cancelled_at || (award.order_status && award.order_status !== "paid")) return { index: -1, label: "Em análise pela equipe" };
  if (award.shipment_status === "delivered") return { index: 3, label: "Entregue" };
  if (award.shipment_id && award.shipment_status !== "cancelled") return { index: 2, label: "Vinculado ao envio" };
  if (award.moved_at) return { index: 1, label: "Separado na sua caixa" };
  return { index: 0, label: "Aguardando separação" };
}
/** Dedução de 1% sobre o bruto exibido, arredondada para centavos. Não altera pagamentos. */
export function raffleNetRevenue(received: number) {
  const grossCents = Number.isFinite(received) ? Math.max(0, Math.round(received * 100)) : 0;
  const feeCents = Math.round(grossCents / 100);
  return { gross: grossCents / 100, fee: feeCents / 100, net: (grossCents - feeCents) / 100 };
}
