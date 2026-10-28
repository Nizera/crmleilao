import "server-only";

import { unstable_cache } from "next/cache";

import { isChargeActive, type ChargeStatus } from "@/lib/charges";
import {
  isoDayAdd,
  isIsoDay,
  spDayEndUtc,
  spDayStartUtc,
  spMonthOf,
  spMonthStartUtc,
  spToday,
} from "@/lib/dates";
import { LOT_STATUS_LABELS, type LotStatus } from "@/lib/lots";
import { createAdminClient } from "@/lib/supabase/admin";
import { isInAuctionPeriod, resolveAuctionPeriod } from "@/lib/auction-period";

/**
 * Estatísticas agregadas do dashboard (F5).
 * Uma única passada por lote/cobrança/cliente/envio — sem RPC, tudo PostgREST
 * com colunas leves. `ready.*` fala qual migração falta quando algo vier vazio.
 *
 * O "dia" é sempre o civil de America/Sao_Paulo (`src/lib/dates.ts`) — nunca o
 * UTC do servidor. O parâmetro `asOf` (YYYY-MM-DD) desloca o recorte de
 * dinheiro/histórico, para revisar o dashboard de um dia específico. Pipeline,
 * envios e cobranças em aberto são estado atual (sem histórico reconstruível).
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
  "code, title, status, arremate_value, created_at, paid_at, shipping_date, customer_id,",
  "customer:customers(id, name)",
].join(" ");

type LotRow = {
  code: string;
  title: string;
  status: LotStatus;
  arremate_value: number | string;
  paid_at: string | null;
  created_at: string;
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

const LOTS_PAGE_SIZE = 500;

async function fetchAllLots(supabase: ReturnType<typeof createAdminClient>) {
  const rows: LotRow[] = [];
  for (let from = 0; ; from += LOTS_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("lots")
      .select(LOT_SELECT)
      .order("id", { ascending: true })
      .range(from, from + LOTS_PAGE_SIZE - 1);
    if (error) return { data: null, error };
    const page = (data ?? []) as unknown as LotRow[];
    rows.push(...page);
    if (page.length < LOTS_PAGE_SIZE) return { data: rows, error: null };
  }
}

export type DashboardStats = {
  ready: {
    lots: boolean;
    charges: boolean;
    customers: boolean;
    shipments: boolean;
    closing: boolean;
  };
  revenue: {
    /** Total dos lotes cadastrados no dia (SP), sem cancelados; independente do recebimento. */
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
    openAmount: number;
    expiring24h: number;
    approvalRate: number | null;
    recentCreated: number;
    recentApproved: number;
  };
  customers: { total: number; newInMonth: number; withoutEmail: number };
  shipments: { toShip: number; posted: number; delivered: number };
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

/**
 * Núcleo da estatística (sem cache). Só service role: roda fora do escopo da
 * requisição, condição para entrar em `unstable_cache`.
 *
 * Cobranças vêm de um recorte (abertas ∪ 30 dias até o dia-alvo) e clientes/
 * envios vêm de contagens `head` — nada de varrer tabela inteira a cada visita.
 */
async function computeDashboardStats(asOf: string, from?: string, to?: string): Promise<DashboardStats> {
  const period = resolveAuctionPeriod(asOf, { from, to });
  const supabase = createAdminClient();
  const now = new Date();
  const today = spToday();
  const day = isIsoDay(asOf) ? asOf : today;

  // Limites do dia-alvo em UTC: é tudo o que o recorte de dinheiro enxerga.
  const dayEndUtc = spDayEndUtc(day);
  const dayEndMs = Date.parse(dayEndUtc);
  const month = day.slice(0, 7);
  const firstOfMonthIso = spMonthStartUtc(month);
  const cutoff30Iso = spDayStartUtc(isoDayAdd(day, -29));
  const cutoff30Ms = Date.parse(cutoff30Iso);

  const [
    lotsRes,
    chargesRes,
    customersTotalRes,
    customersMonthRes,
    customersNoEmailRes,
    shipmentsOpenRes,
    shipmentsPostedRes,
    shipmentsDeliveredRes,
  ] = await Promise.all([
    fetchAllLots(supabase),
    // Abertas (qualquer data) + criadas na janela de 30 dias até o dia-alvo.
    supabase
      .from("charges")
      .select("status, amount, expires_at, paid_at, created_at")
      .lt("created_at", dayEndUtc)
      .or(`status.in.(pending,in_process),created_at.gte.${cutoff30Iso}`),
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .lt("created_at", dayEndUtc),
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .gte("created_at", firstOfMonthIso)
      .lt("created_at", dayEndUtc),
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
  ] as const) {
    if (res.error) console.error(`[dashboard] falha em ${name}: ${res.error.message}`);
  }

  const lots = (lotsRes.data ?? []) as unknown as LotRow[];
  const chargeRows = (chargesRes.data ?? []) as unknown as ChargeRow[];

  /* ------------------------------ receita ------------------------------- */

  // 6 meses terminando no mês do dia-alvo.
  const months: DashboardStats["revenue"]["months"] = [];
  const monthIndex = new Map<string, { label: string; value: number }>();
  const [monthYear, monthNumber] = month.split("-").map(Number) as [
    number,
    number,
  ];
  for (let i = 5; i >= 0; i -= 1) {
    const bucketDate = new Date(Date.UTC(monthYear, monthNumber - 1 - i, 15));
    const bucket = { label: MONTH_LABELS[bucketDate.getUTCMonth()], value: 0 };
    months.push(bucket);
    monthIndex.set(bucketDate.toISOString().slice(0, 7), bucket);
  }

  let totalRevenue = 0;
  let paidLots = 0;
  let dayRevenue = 0;
  let dayReceived = 0;
  let dayReceivedLots = 0;
  let dayLots = 0;
  for (const lot of lots) {
    const inPeriod = isInAuctionPeriod(lot.created_at, period);
    if (lot.status !== "cancelled" && inPeriod) {
      dayRevenue += Number(lot.arremate_value);
      dayLots += 1;
    }
    if (!REVENUE_STATUSES.has(lot.status) || !lot.paid_at) continue;
    const value = Number(lot.arremate_value);
    // Fechamento por leilão: recebimentos dos lotes cadastrados no período,
    // mesmo quando o cliente confirma o pagamento depois do encerramento.
    if (inPeriod) { dayReceived += value; dayReceivedLots += 1; }
    // Recorte de dinheiro: só o que já tinha acontecido no fim do dia-alvo.
    if (Date.parse(lot.paid_at) >= dayEndMs) continue;
    totalRevenue += value;
    paidLots += 1;
    const bucket = monthIndex.get(spMonthOf(lot.paid_at));
    if (bucket) bucket.value += value;

  }

  const monthRevenue = months[5].value;
  const prevRevenue = months[4].value;
  const deltaPct =
    prevRevenue > 0
      ? Math.round(((monthRevenue - prevRevenue) / prevRevenue) * 100)
      : null;

  /* ------------------------------ cobranças ----------------------------- */

  const open = chargeRows.filter((charge) => isChargeActive(charge, now));
  const openAmount = open.reduce((sum, c) => sum + Number(c.amount), 0);
  const in24h = open.filter((c) => {
    if (!c.expires_at) return false;
    return new Date(c.expires_at).getTime() - now.getTime() < 86_400_000;
  }).length;
  const recent = chargeRows.filter(
    (c) =>
      Date.parse(c.created_at) >= cutoff30Ms &&
      Date.parse(c.created_at) < dayEndMs,
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
    if (!REVENUE_STATUSES.has(lot.status) || !lot.paid_at) continue;
    if (Date.parse(lot.paid_at) >= dayEndMs) continue;
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
    .filter(
      (lot) =>
        REVENUE_STATUSES.has(lot.status) &&
        lot.paid_at &&
        Date.parse(lot.paid_at) < dayEndMs,
    )
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
  // Operacional: olha o hoje real, não o dia-alvo.

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
      closing: lotsRes.error === null,
    },
    revenue: {
      day: dayRevenue,
      dayLots,
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
    closing: {
      receivedOn: dayReceived,
      paidLotsOn: dayReceivedLots,
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
 *
 * O `asOf` participa da cache key (argumento da função), então cada dia
 * consultado tem seu próprio cache.
 */
export const getDashboardStats = unstable_cache(
  computeDashboardStats,
  ["dashboard-stats"],
  { tags: ["dashboard"], revalidate: 30 },
);
