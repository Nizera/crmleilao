import "server-only";
import { unstable_cache } from "next/cache";
import { isChargeActive, type ChargeStatus } from "@/lib/charges";
import { spMonthOf, spToday } from "@/lib/dates";
import { LOT_STATUS_LABELS, type LotStatus } from "@/lib/lots";
import { createAdminClient } from "@/lib/supabase/admin";
import { isInAuctionPeriod, resolveAuctionPeriod } from "@/lib/auction-period";
import { computePeriodFreight, type ScopeLot, type ScopeCharge, type ScopeShipment, type ScopeFreightUsage, type ScopeFreightItem, type PeriodFreightStats } from "@/lib/dashboard-scope";
import { fetchScopeRows } from "@/lib/dashboard-scope-server";

const MONTH_LABELS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const REVENUE_STATUSES = new Set<LotStatus>(["paid", "shipped", "delivered"]);
const PIPELINE_ORDER: LotStatus[] = ["pending_payment", "paid", "shipped", "delivered", "cancelled"];
const LOT_SELECT = "id, code, title, status, arremate_value, created_at, paid_at, shipping_date, customer_id, charge_id, customer:customers(id, name, email, created_at)";

export type DashboardStats = {
  ready: {
    lots: boolean;
    charges: boolean;
    customers: boolean;
    shipments: boolean;
    closing: boolean;
    freight: boolean;
  };
  revenue: {
    /** Total dos lotes cadastrados no intervalo (SP), sem cancelados. */
    day: number;
    dayLots: number;
    month: number;
    prevMonth: number;
    deltaPct: number | null;
    total: number;
    paidLots: number;
    ticket: number;
    months: { label: string; value: number }[];
  };
  charges: {
    openCount: number;
    pendingLotsCount: number;
    openAmount: number;
    expiring24h: number;
    approvalRate: number | null;
    recentCreated: number;
    recentApproved: number;
  };
  customers: { total: number; newInPeriod: number; withoutEmail: number };
  shipments: { toShip: number; posted: number; delivered: number };
  freight: PeriodFreightStats;
  closing: {
    receivedOn: number;
    paidLotsOn: number;
  };
  pipeline: { status: LotStatus; label: string; count: number; value: number }[];
  ranking: { id: string; name: string; lots: number; total: number }[];
  recentPayments: {
    code: string;
    title: string;
    customer: string;
    value: number;
    paidAt: string;
  }[];
  nextBatch: { shippingDate: string; count: number } | null;
};

/** Mensal/acumulado são gerais. Todos os demais dados pertencem aos lotes cadastrados no intervalo. */
async function computeDashboardStats(asOf: string, from?: string, to?: string): Promise<DashboardStats> {
  const period = resolveAuctionPeriod(asOf, { from, to });
  const db = createAdminClient();
  const today = spToday();
  const now = new Date();
  const allLots: ScopeLot[] = [];
  let lotsError: { message: string } | null = null;
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db.from("lots").select(LOT_SELECT).order("id", { ascending: true }).range(offset, offset + 499);
    if (error) { lotsError = error; break; }
    const page = (data ?? []) as unknown as ScopeLot[];
    allLots.push(...page);
    if (page.length < 500) break;
  }
  const scoped = allLots.filter(lot => isInAuctionPeriod(lot.created_at, period));
  const active = scoped.filter(lot => lot.status !== "cancelled");
  const customerIds = [...new Set(active.map(lot => lot.customer_id))];
  const lotIds = active.map(lot => lot.id);
  const [chargesRes, linksRes, usageRes, freightRes] = await Promise.all([
    fetchScopeRows<ScopeCharge>(db, "charges", "customer_id", customerIds, "id, customer_id, status, amount, freight_amount, expires_at, paid_at"),
    fetchScopeRows<ScopeShipment>(db, "shipment_lots", "lot_id", lotIds, "lot_id, shipment_id, shipment:shipments(id, status)", ["shipment_id", "lot_id"]),
    fetchScopeRows<ScopeFreightUsage>(db, "shipment_freight_usage", "customer_id", customerIds, "charge_id, shipment_id, shipment:shipments(status)", ["charge_id"]),
    fetchScopeRows<ScopeFreightItem>(db, "charge_freight_items", "customer_id", customerIds, "charge_id, first_lot_id, freight_period, freight_amount", ["charge_id", "freight_period"]),
  ]);
  for (const result of [chargesRes, linksRes, usageRes, freightRes]) if (result.error) console.error("[dashboard] falha na consulta do período:", result.error.message);
  if (lotsError) console.error("[dashboard] falha nos lotes:", lotsError.message);
  const paid = active.filter(lot => REVENUE_STATUSES.has(lot.status) && lot.paid_at);
  const pending = active.filter(lot => lot.status === "pending_payment");
  const sum = (lots: ScopeLot[]) => lots.reduce((value, lot) => value + Number(lot.arremate_value), 0);
  const allPaid = allLots.filter(lot => REVENUE_STATUSES.has(lot.status) && lot.paid_at);
  const currentMonth = today.slice(0, 7);
  const [year, month] = currentMonth.split("-").map(Number);
  const previousMonth = new Date(Date.UTC(year, month - 2, 15)).toISOString().slice(0, 7);
  const monthRevenue = sum(allPaid.filter(lot => spMonthOf(lot.paid_at!) === currentMonth));
  const previousRevenue = sum(allPaid.filter(lot => spMonthOf(lot.paid_at!) === previousMonth));
  const months: DashboardStats["revenue"]["months"] = [];
  const monthIndex = new Map<string, { label: string; value: number }>();
  const [selectedYear, selectedMonth] = period.to.slice(0, 7).split("-").map(Number);
  for (let index = 5; index >= 0; index--) {
    const date = new Date(Date.UTC(selectedYear, selectedMonth - 1 - index, 15));
    const bucket = { label: MONTH_LABELS[date.getUTCMonth()], value: 0 };
    months.push(bucket); monthIndex.set(date.toISOString().slice(0, 7), bucket);
  }
  for (const lot of paid) {
    const bucket = monthIndex.get(spMonthOf(lot.created_at));
    if (bucket) bucket.value += Number(lot.arremate_value);
  }
  const chargeIds = new Set(active.map(lot => lot.charge_id).filter(Boolean));
  const charges = chargesRes.data.filter(charge => chargeIds.has(charge.id));
  const open = charges.filter(charge => isChargeActive({ status: charge.status as ChargeStatus, expires_at: charge.expires_at }, now));
  const customers = new Map(active.map(lot => [lot.customer_id, lot.customer]));
  const shipments = new Map(linksRes.data.filter(link => link.shipment && link.shipment.status !== "cancelled").map(link => [link.shipment_id, link.shipment!]));
  const pipeline = PIPELINE_ORDER.map(status => {
    const rows = scoped.filter(lot => lot.status === status);
    return { status, label: LOT_STATUS_LABELS[status], count: rows.length, value: sum(rows) };
  });
  const rankMap = new Map<string, { id: string; name: string; lots: number; total: number }>();
  for (const lot of paid) {
    const row = rankMap.get(lot.customer_id) ?? { id: lot.customer_id, name: lot.customer?.name?.trim() || "Sem nome", lots: 0, total: 0 };
    row.lots++; row.total += Number(lot.arremate_value); rankMap.set(lot.customer_id, row);
  }
  const batches = new Map<string, number>();
  for (const lot of active) if (lot.status === "paid" && lot.shipping_date && lot.shipping_date >= today) batches.set(lot.shipping_date, (batches.get(lot.shipping_date) ?? 0) + 1);
  const nextBatch = [...batches.entries()].sort(([a], [b]) => a.localeCompare(b))[0];
  return {
    ready: { lots: !lotsError, charges: !lotsError && !chargesRes.error, customers: !lotsError, shipments: !lotsError && !linksRes.error, closing: !lotsError, freight: !lotsError && !chargesRes.error && !linksRes.error && !usageRes.error && !freightRes.error },
    revenue: {
      day: sum(active), dayLots: active.length, month: monthRevenue, prevMonth: previousRevenue,
      deltaPct: previousRevenue > 0 ? Math.round((monthRevenue - previousRevenue) / previousRevenue * 100) : null,
      total: sum(allPaid), paidLots: allPaid.length, ticket: paid.length ? sum(paid) / paid.length : 0, months,
    },
    charges: {
      openAmount: sum(pending), pendingLotsCount: pending.length, openCount: open.length,
      expiring24h: open.filter(charge => charge.expires_at && Date.parse(charge.expires_at) - now.getTime() < 86400000).length,
      approvalRate: charges.length ? charges.filter(charge => charge.status === "approved").length / charges.length : null,
      recentCreated: charges.length, recentApproved: charges.filter(charge => charge.status === "approved").length,
    },
    customers: {
      total: customers.size,
      newInPeriod: [...customers.values()].filter(customer => customer?.created_at && isInAuctionPeriod(customer.created_at, period)).length,
      withoutEmail: [...customers.values()].filter(customer => !customer?.email?.trim()).length,
    },
    shipments: {
      toShip: [...shipments.values()].filter(s => ["pending", "released"].includes(s.status)).length,
      posted: [...shipments.values()].filter(s => s.status === "posted").length,
      delivered: [...shipments.values()].filter(s => s.status === "delivered").length,
    },
    freight: chargesRes.error || linksRes.error || usageRes.error || freightRes.error || lotsError
      ? { total: 0, paidCount: 0, carriedCount: 0, pendingCount: 0 }
      : computePeriodFreight(allLots, active, chargesRes.data, linksRes.data, usageRes.data, freightRes.data),
    closing: { receivedOn: sum(paid), paidLotsOn: paid.length },
    pipeline, ranking: [...rankMap.values()].sort((a, b) => b.total - a.total).slice(0, 5),
    recentPayments: [...paid].sort((a, b) => b.paid_at!.localeCompare(a.paid_at!)).slice(0, 5).map(lot => ({ code: lot.code, title: lot.title, customer: lot.customer?.name?.trim() || "Sem nome", value: Number(lot.arremate_value), paidAt: lot.paid_at! })),
    nextBatch: nextBatch ? { shippingDate: nextBatch[0], count: nextBatch[1] } : null,
  };
}

export const getDashboardStats = unstable_cache(computeDashboardStats, ["dashboard-period-stats-v2"], { tags: ["dashboard"], revalidate: 30 });
