import type { Shipment } from "./shipments";
import type { ShipmentQueueRow } from "./shipments-server";

export function unifiedShipmentRows(queue: ShipmentQueueRow[], shipments: Shipment[]): ShipmentQueueRow[] {
  const byId = new Map(shipments.map(s => [s.id, s]));
  for (const row of queue) if (row.pendingShipment && !byId.has(row.pendingShipment.id)) byId.set(row.pendingShipment.id, {...row.pendingShipment, lots: row.lots});
  const linkedLots = new Set([...byId.values()].filter(s => s.status !== "cancelled").flatMap(s => s.lots?.map(l => l.id) ?? []));
  const result: ShipmentQueueRow[] = [...byId.values()].map(s => {
    const source = queue.find(r => r.pendingShipment?.id === s.id);
    const sourceLots = source?.lots.filter(l => s.lots?.some(ref => ref.id === l.id)) ?? [];
    return source ? { ...source, lots: sourceLots, paidTotal: sourceLots.filter(l=>l.status!=="pending_payment").reduce((n,l)=>n+l.arremate_value,0), unpaidTotal: sourceLots.filter(l=>l.status==="pending_payment").reduce((n,l)=>n+l.arremate_value,0), pendingShipment: s } : {
      customerId: s.customer_id, name: s.customer?.name ?? s.address?.name ?? null,
      phone_e164: s.customer?.phone_e164 ?? "", lots: (s.lots ?? []).map(l => ({...l, arremate_value: 0, status: s.status === "delivered" ? "delivered" : "shipped", shipping_date: s.batch_date, auction_date: l.auction_date ?? ""})),
      paidTotal: 0, unpaidTotal: 0, shippingDate: s.batch_date, pendingShipment: s,
      freightStatus: s.status === "cancelled" ? "none" : "paid", hasActiveCharge: false,
      companyFreight: s.freight_payer === "company", labelOnly: true,
    };
  });
  for (const row of queue) {
    const lots = row.lots.filter(l => !linkedLots.has(l.id));
    if (row.pendingShipment && !lots.length && !(row.storeOrderCount || row.raffleAwardCount)) continue;
    if (row.lots.length && !lots.length) continue;
    result.push({...row, lots, paidTotal: lots.filter(l=>l.status!=="pending_payment").reduce((n,l)=>n+l.arremate_value,0), unpaidTotal: lots.filter(l=>l.status==="pending_payment").reduce((n,l)=>n+l.arremate_value,0), pendingShipment: null});
  }
  return result;
}

export function shipmentListSummary(rows: ShipmentQueueRow[]) {
  const labels = new Map(rows.filter(r => r.pendingShipment).map(r => [r.pendingShipment!.id, r.pendingShipment!]));
  const active = [...labels.values()].filter(s => s.status !== "cancelled");
  const cents = (v: number | null | undefined) => Math.round(Number(v ?? 0) * 100);
  const emission = active.reduce((sum,s) => sum+cents(s.original_price ?? s.price),0);
  const current = active.reduce((sum,s) => sum+cents(s.price ?? s.original_price),0);
  return {labels: active.length, cancelled: labels.size-active.length, emissionTotal: emission/100, currentTotal: current/100, adjustmentTotal: (current-emission)/100, changedLabels: active.filter(s => cents(s.price ?? s.original_price)!==cents(s.original_price ?? s.price)).length, unknownPrices: active.filter(s=>s.price==null&&s.original_price==null).length, legacyPrices: active.filter(s=>s.price_baseline_legacy).length};
}
