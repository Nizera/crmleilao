import type { LotStatus } from "@/lib/lots";
import { spWeekdayKey, type FreightDayKey } from "@/lib/freight";

export type ScopeLot = {
  id: string; code: string; title: string; status: LotStatus;
  arremate_value: number | string; paid_at: string | null; created_at: string;
  shipping_date: string | null; customer_id: string; charge_id: string | null;
  customer: { id: string; name: string | null; email?: string | null; created_at?: string } | null;
};
export type ScopeCharge = {
  id: string; customer_id: string; status: string; amount: number | string;
  freight_amount: number | string; paid_at: string | null; expires_at: string | null;
};
export type ScopeShipment = { lot_id: string; shipment_id: string; shipment: { id: string; status: string } | null };
export type ScopeFreightUsage = { charge_id: string; shipment_id: string; shipment: { status: string } | null };
export type ScopeFreightItem = { charge_id: string; first_lot_id: string | null; freight_period: string; freight_amount: number | string };
export type PeriodFreightStats = { total: number; byDay: Record<FreightDayKey, number>; paidCount: number; carriedCount: number; pendingCount: number };

/** Valores de Pix podem reunir vários leilões: o dashboard soma somente sua parcela em lotes. */
export function pendingAmountByCharge(lots: ScopeLot[]) {
  const totals = new Map<string, number>();
  for (const lot of lots) if (lot.status === "pending_payment" && lot.charge_id) {
    totals.set(lot.charge_id, (totals.get(lot.charge_id) ?? 0) + Number(lot.arremate_value));
  }
  return totals;
}

/** Frete pertence ao primeiro lote do pacote; créditos anteriores cobrem, mas não geram nova receita. */
export function computePeriodFreight(
  allLots: ScopeLot[], lots: ScopeLot[], charges: ScopeCharge[],
  links: ScopeShipment[], usage: ScopeFreightUsage[], items: ScopeFreightItem[],
): PeriodFreightStats {
  const selected = new Set(lots.filter(l => l.status !== "cancelled").map(l => l.id));
  const approved = new Map(charges.filter(c => c.status === "approved" && Number(c.freight_amount) > 0).map(c => [c.id, c]));
  const consumed = new Set(usage.filter(u => u.shipment && u.shipment.status !== "cancelled").map(u => u.charge_id));
  const available = new Set([...approved.values()].filter(c => !consumed.has(c.id)).map(c => c.customer_id));
  const paidShipments = new Set(usage.filter(u => approved.has(u.charge_id) && u.shipment && u.shipment.status !== "cancelled").map(u => u.shipment_id));
  const byLot = new Map<string, ScopeShipment[]>();
  for (const link of links) if (link.shipment && link.shipment.status !== "cancelled") byLot.set(link.lot_id, [...(byLot.get(link.lot_id) ?? []), link]);
  const firstByCharge = new Map<string, string>();
  for (const lot of [...allLots].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))) {
    if (lot.charge_id && lot.status !== "cancelled" && !firstByCharge.has(lot.charge_id)) firstByCharge.set(lot.charge_id, lot.id);
  }
  const paidCustomers = new Set<string>();
  let total = 0;
  const byDay: Record<FreightDayKey, number> = { ter: 0, qua: 0, qui: 0, sex: 0, sab: 0, dom: 0, seg: 0 };
  const addPaid = (charge: ScopeCharge, amount: number) => {
    total += amount;
    paidCustomers.add(charge.customer_id);
    const day = charge.paid_at ? spWeekdayKey(charge.paid_at) : null;
    if (day) byDay[day] += amount;
  };
  const itemsByCharge = new Map<string, ScopeFreightItem[]>();
  for (const item of items) itemsByCharge.set(item.charge_id, [...(itemsByCharge.get(item.charge_id) ?? []), item]);
  for (const charge of approved.values()) {
    const parts = itemsByCharge.get(charge.id) ?? [];
    if (parts.length) {
      const seen = new Set<string>();
      for (const part of parts) {
        if (seen.has(part.freight_period)) continue;
        seen.add(part.freight_period);
        if (selected.has(part.first_lot_id ?? firstByCharge.get(charge.id) ?? "")) {
          addPaid(charge, Number(part.freight_amount));
        }
      }
    } else if (selected.has(firstByCharge.get(charge.id) ?? "")) {
      addPaid(charge, Number(charge.freight_amount));
    }
  }
  const uncovered = new Set<string>();
  const customers = new Set(lots.filter(l => l.status !== "cancelled").map(l => l.customer_id));
  for (const lot of lots) if (lot.status !== "cancelled") {
    const shipments = byLot.get(lot.id) ?? [];
    const covered = shipments.length
      ? shipments.some(s => paidShipments.has(s.shipment_id))
      : available.has(lot.customer_id);
    if (!covered) uncovered.add(lot.customer_id);
  }
  return {
    total: Math.round(total * 100) / 100, paidCount: paidCustomers.size,
    byDay: Object.fromEntries(Object.entries(byDay).map(([day, amount]) => [day, Math.round(amount * 100) / 100])) as Record<FreightDayKey, number>,
    carriedCount: [...customers].filter(id => !uncovered.has(id) && !paidCustomers.has(id)).length,
    pendingCount: uncovered.size,
  };
}
