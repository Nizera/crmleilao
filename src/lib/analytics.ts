import "server-only";

import { listStock } from "@/lib/dal";
import { isChargeActive, type ChargeStatus } from "@/lib/charges";
import { LOT_STATUS_LABELS, type LotStatus } from "@/lib/lots";
import { createClient } from "@/lib/supabase/server";

/**
 * Estatísticas agregadas do dashboard (F5).
 * Uma única passada por lote/cobrança/cliente/envio — sem RPC, tudo PostgREST
 * com colunas leves. `ready.*` fala qual migração falta quando algo vier vazio.
 */

const MONTH_LABELS = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

/** Status que contam como faturamento (exclui cancelled e pending). */
const REVENUE_STATUSES = new Set<LotStatus>(["paid", "shipped", "delivered"]);

const PIPELINE_ORDER: LotStatus[] = [
  "pending_payment",
  "paid",
  "shipped",
  "delivered",
  "cancelled",
];

const LOT_SELECT = [
  "code, title, status, arremate_value, paid_at, shipping_date, customer_id,",
  "customer:customers(id, name)",
].join(" ");

type LotRow = {
  code: string;
  title: string;
  status: LotStatus;
  arremate_value: number | string;
  paid_at: string | null;
  shipping_date: string | null;
  customer_id: string;
  customer: { id: string; name: string | null } | null;
};

type ChargeRow = {
  status: ChargeStatus;
  amount: number | string;
  expires_at: string | null;
  paid_at: string | null;
  created_at: string;
};

export type DashboardStats = {
  ready: {
    lots: boolean;
    charges: boolean;
    customers: boolean;
    shipments: boolean;
    stock: boolean;
  };
  revenue: {
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
    openAmount: number;
    expiring24h: number;
    approvalRate: number | null;
    recentCreated: number;
    recentApproved: number;
  };
  customers: { total: number; newInMonth: number; withoutEmail: number };
  shipments: { toShip: number; posted: number; delivered: number };
  stock: { units: number; skus: number; negatives: number };
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

export async function getDashboardStats(): Promise<DashboardStats> {
  const supabase = await createClient();
  const now = new Date();

  const [lotsRes, chargesRes, customersRes, shipmentsRes, stock] =
    await Promise.all([
      supabase.from("lots").select(LOT_SELECT),
      supabase
        .from("charges")
        .select("status, amount, expires_at, paid_at, created_at"),
      supabase.from("customers").select("id, email, created_at"),
      supabase.from("shipments").select("status"),
      listStock()
        .then((items) => ({ ok: true as const, items }))
        .catch(() => ({ ok: false as const, items: [] })),
    ]);

  for (const [name, res] of [
    ["lots", lotsRes],
    ["charges", chargesRes],
    ["customers", customersRes],
    ["shipments", shipmentsRes],
  ] as const) {
    if (res.error) console.error(`[dashboard] falha em ${name}: ${res.error.message}`);
  }

  const lots = (lotsRes.data ?? []) as unknown as LotRow[];
  const chargeRows = (chargesRes.data ?? []) as unknown as ChargeRow[];
  const customerRows = (customersRes.data ?? []) as {
    id: string;
    email: string | null;
    created_at: string;
  }[];
  const shipmentRows = (shipmentsRes.data ?? []) as { status: string }[];

  /* ------------------------------ receita ------------------------------- */

  const months: DashboardStats["revenue"]["months"] = [];
  const monthIndex = new Map<string, { label: string; value: number }>();
  const firstOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(firstOfMonth);
    d.setUTCMonth(d.getUTCMonth() - i);
    const bucket = { label: MONTH_LABELS[d.getUTCMonth()], value: 0 };
    months.push(bucket);
    monthIndex.set(d.toISOString().slice(0, 7), bucket);
  }
  let totalRevenue = 0;
  let paidLots = 0;
  for (const lot of lots) {
    if (!REVENUE_STATUSES.has(lot.status)) continue;
    const value = Number(lot.arremate_value);
    totalRevenue += value;
    paidLots += 1;
    if (lot.paid_at) {
      const bucket = monthIndex.get(lot.paid_at.slice(0, 7));
      if (bucket) bucket.value += value;
    }
  }

  const monthRevenue = months[5].value;
  const prevRevenue = months[4].value;
  const deltaPct =
    prevRevenue > 0
      ? Math.round(((monthRevenue - prevRevenue) / prevRevenue) * 100)
      : null;

  /* ------------------------------ cobranças ----------------------------- */

  const open = chargeRows.filter((charge) => isChargeActive(charge));
  const openAmount = open.reduce((sum, c) => sum + Number(c.amount), 0);
  const in24h = open.filter((c) => {
    if (!c.expires_at) return false;
    return new Date(c.expires_at).getTime() - now.getTime() < 86_400_000;
  }).length;
  const cutoff30 = now.getTime() - 30 * 86_400_000;
  const recent = chargeRows.filter(
    (c) => new Date(c.created_at).getTime() >= cutoff30,
  );
  const recentApproved = recent.filter((c) => c.status === "approved").length;

  /* ------------------------------ clientes ------------------------------ */

  const currentKey = now.toISOString().slice(0, 7);
  const newInMonth = customerRows.filter((c) =>
    c.created_at.startsWith(currentKey),
  ).length;
  const withoutEmail = customerRows.filter(
    (c) => !c.email?.trim(),
  ).length;

  /* ------------------------------- envios ------------------------------- */

  const shipments = { toShip: 0, posted: 0, delivered: 0 };
  for (const row of shipmentRows) {
    if (row.status === "pending" || row.status === "released") {
      shipments.toShip += 1;
    } else if (row.status === "posted") {
      shipments.posted += 1;
    } else if (row.status === "delivered") {
      shipments.delivered += 1;
    }
  }

  /* -------------------------------- estoque ----------------------------- */

  const stockItems = stock.items;
  const units = stockItems.reduce((sum, item) => sum + item.qty_on_hand, 0);
  const negatives = stockItems.filter((item) => item.qty_on_hand < 0).length;

  /* --------------------------- pipeline de lotes ------------------------ */

  const pipelineMap = new Map<LotStatus, { count: number; value: number }>(
    PIPELINE_ORDER.map((status) => [status, { count: 0, value: 0 }]),
  );
  for (const lot of lots) {
    const bucket = pipelineMap.get(lot.status);
    if (!bucket) continue;
    bucket.count += 1;
    bucket.value += Number(lot.arremate_value);
  }
  const pipeline = PIPELINE_ORDER.map((status) => ({
    status,
    label: LOT_STATUS_LABELS[status],
    count: pipelineMap.get(status)?.count ?? 0,
    value: pipelineMap.get(status)?.value ?? 0,
  }));

  /* ------------------------------ ranking ------------------------------- */

  const rankMap = new Map<
    string,
    { id: string; name: string; lots: number; total: number }
  >();
  for (const lot of lots) {
    if (!REVENUE_STATUSES.has(lot.status)) continue;
    const entry =
      rankMap.get(lot.customer_id) ??
      {
        id: lot.customer_id,
        name: lot.customer?.name?.trim() || "Sem nome",
        lots: 0,
        total: 0,
      };
    entry.lots += 1;
    entry.total += Number(lot.arremate_value);
    rankMap.set(lot.customer_id, entry);
  }
  const ranking = [...rankMap.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  /* --------------------------- últimos pagamentos ----------------------- */

  const recentPayments = lots
    .filter((lot) => REVENUE_STATUSES.has(lot.status) && lot.paid_at)
    .sort((a, b) => (b.paid_at ?? "").localeCompare(a.paid_at ?? ""))
    .slice(0, 5)
    .map((lot) => ({
      code: lot.code,
      title: lot.title,
      customer: lot.customer?.name?.trim() || "Sem nome",
      value: Number(lot.arremate_value),
      paidAt: lot.paid_at ?? "",
    }));

  /* ------------------------- próximo lote de envio ---------------------- */

  const today = now.toLocaleDateString("en-CA");
  const awaiting = lots.filter(
    (lot) =>
      lot.status === "paid" &&
      lot.shipping_date &&
      lot.shipping_date >= today,
  );
  const batchMap = new Map<string, number>();
  for (const lot of awaiting) {
    const key = lot.shipping_date as string;
    batchMap.set(key, (batchMap.get(key) ?? 0) + 1);
  }
  const nextBatchEntry = [...batchMap.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )[0];
  const nextBatch = nextBatchEntry
    ? { shippingDate: nextBatchEntry[0], count: nextBatchEntry[1] }
    : null;

  return {
    ready: {
      lots: lotsRes.error === null,
      charges: chargesRes.error === null,
      customers: customersRes.error === null,
      shipments: shipmentsRes.error === null,
      stock: stock.ok,
    },
    revenue: {
      month: monthRevenue,
      prevMonth: prevRevenue,
      deltaPct,
      total: totalRevenue,
      paidLots,
      ticket: paidLots > 0 ? totalRevenue / paidLots : 0,
      months,
    },
    charges: {
      openCount: open.length,
      openAmount,
      expiring24h: in24h,
      approvalRate: recent.length > 0 ? recentApproved / recent.length : null,
      recentCreated: recent.length,
      recentApproved,
    },
    customers: {
      total: customerRows.length,
      newInMonth,
      withoutEmail,
    },
    shipments,
    stock: {
      units,
      skus: stockItems.length,
      negatives,
    },
    pipeline,
    ranking,
    recentPayments,
    nextBatch,
  };
}
