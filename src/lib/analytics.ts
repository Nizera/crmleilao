import "server-only";

import { unstable_cache } from "next/cache";

import { listStockAdmin } from "@/lib/dal";
import { isChargeActive, type ChargeStatus } from "@/lib/charges";
import { LOT_STATUS_LABELS, type LotStatus } from "@/lib/lots";
import { createAdminClient } from "@/lib/supabase/admin";

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
    closing: boolean;
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
  closing: {
    receivedToday: number;
    paidLotsToday: number;
    staffPaid: number;
    staffTotal: number;
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

/**
 * Núcleo da estatística (sem cache). Só service role: roda fora do escopo da
 * requisição, condção para entrar em `unstable_cache`.
 *
 * Cobranças vêm de um recorte (abertas ∪ últimos 30 dias) e clientes/envios
 * vêm de contagens `head` — nada de varrer tabela inteira a cada visita.
 */
async function computeDashboardStats(): Promise<DashboardStats> {
  const supabase = createAdminClient();
  const now = new Date();

  const firstOfMonthIso = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();
  const cutoff30Iso = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const today = now.toLocaleDateString("en-CA");

  const [
    lotsRes,
    chargesRes,
    customersTotalRes,
    customersMonthRes,
    customersNoEmailRes,
    shipmentsOpenRes,
    shipmentsPostedRes,
    shipmentsDeliveredRes,
    staffTotalRes,
    staffPaidTodayRes,
    stock,
  ] = await Promise.all([
    supabase.from("lots").select(LOT_SELECT),
    // Abertas (qualquer data) + criadas nos últimos 30 dias: é tudo o que a
    // página calcula (open*, recent*, approvalRate).
    supabase
      .from("charges")
      .select("status, amount, expires_at, paid_at, created_at")
      .or(`status.in.(pending,in_process),created_at.gte.${cutoff30Iso}`),
    supabase.from("customers").select("id", { count: "exact", head: true }),
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .gte("created_at", firstOfMonthIso),
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .or("email.is.null,email.eq."),
    supabase
      .from("shipments")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "released"]),
    supabase
      .from("shipments")
      .select("id", { count: "exact", head: true })
      .eq("status", "posted"),
    supabase
      .from("shipments")
      .select("id", { count: "exact", head: true })
      .eq("status", "delivered"),
    supabase
      .from("admin_profiles")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("staff_payments")
      .select("id", { count: "exact", head: true })
      .eq("payment_date", today),
    listStockAdmin()
      .then((items) => ({ ok: true as const, items }))
      .catch(() => ({ ok: false as const, items: [] })),
  ]);

  for (const [name, res] of [
    ["lots", lotsRes],
    ["charges", chargesRes],
    ["customers", customersTotalRes],
    ["customers-mes", customersMonthRes],
    ["customers-email", customersNoEmailRes],
    ["envios-abertos", shipmentsOpenRes],
    ["envios-postados", shipmentsPostedRes],
    ["envios-entregues", shipmentsDeliveredRes],
    ["equipe", staffTotalRes],
    ["pagamentos-hoje", staffPaidTodayRes],
  ] as const) {
    if (res.error) console.error(`[dashboard] falha em ${name}: ${res.error.message}`);
  }

  const lots = (lotsRes.data ?? []) as unknown as LotRow[];
  const chargeRows = (chargesRes.data ?? []) as unknown as ChargeRow[];

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
  let receivedToday = 0;
  let paidLotsToday = 0;
  for (const lot of lots) {
    if (!REVENUE_STATUSES.has(lot.status)) continue;
    const value = Number(lot.arremate_value);
    totalRevenue += value;
    paidLots += 1;
    if (lot.paid_at) {
      const bucket = monthIndex.get(lot.paid_at.slice(0, 7));
      if (bucket) bucket.value += value;
      if (lot.paid_at.slice(0, 10) === today) {
        receivedToday += value;
        paidLotsToday += 1;
      }
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

  const newInMonth = customersMonthRes.count ?? 0;
  const withoutEmail = customersNoEmailRes.count ?? 0;

  /* ------------------------------- envios ------------------------------- */

  const shipments = {
    toShip: shipmentsOpenRes.count ?? 0,
    posted: shipmentsPostedRes.count ?? 0,
    delivered: shipmentsDeliveredRes.count ?? 0,
  };

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
      customers:
        customersTotalRes.error === null &&
        customersMonthRes.error === null &&
        customersNoEmailRes.error === null,
      shipments:
        shipmentsOpenRes.error === null &&
        shipmentsPostedRes.error === null &&
        shipmentsDeliveredRes.error === null,
      stock: stock.ok,
      closing: staffTotalRes.error === null && staffPaidTodayRes.error === null,
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
      total: customersTotalRes.count ?? 0,
      newInMonth,
      withoutEmail,
    },
    shipments,
    stock: {
      units,
      skus: stockItems.length,
      negatives,
    },
    closing: {
      receivedToday,
      paidLotsToday,
      staffPaid: staffPaidTodayRes.count ?? 0,
      staffTotal: staffTotalRes.count ?? 0,
    },
    pipeline,
    ranking,
    recentPayments,
    nextBatch,
  };
}

/**
 * Estatísticas do dashboard com cache de 30 s (tag `dashboard`): são
 * varreduras de várias tabelas e o custo cresce com o histórico. As actions
 * chamam `updateTag("dashboard")` e os webhooks
 * `revalidateTag("dashboard", { expire: 0 })` junto do `revalidatePath`,
 * para os números voltarem frescos logo após uma mutação.
 */
export const getDashboardStats = unstable_cache(
  computeDashboardStats,
  ["dashboard-stats"],
  { tags: ["dashboard"], revalidate: 30 },
);
