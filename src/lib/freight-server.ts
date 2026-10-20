import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  freightPeriodEnd,
  freightPeriodStart,
  spWeekdayKey,
  type FreightDayKey,
  type FreightWeekStats,
} from "@/lib/freight";

/**
 * Agregados do frete da semana para o card do dashboard:
 * - pago = cobranças aprovadas com frete cujo `paid_at` cai no período
 *   (terça→terça, fuso de São Paulo) — soma e total por dia;
 * - pendentes = clientes com lote no período que ainda não pagaram o frete
 *   daquele período (dedup por `freight_period`).
 */
export async function getFreightWeekStats(): Promise<FreightWeekStats> {
  const admin = createAdminClient();
  const periodStart = freightPeriodStart();
  const periodEnd = freightPeriodEnd(periodStart);

  const stats: FreightWeekStats = {
    periodStart,
    periodEnd,
    total: 0,
    byDay: { ter: 0, qua: 0, qui: 0, sex: 0, sab: 0, dom: 0 },
    paidCount: 0,
    pendingCount: 0,
  };

  // Pagos no período: janela [terça 00:00, próxima terça 00:00) em SP.
  const { data: paidRows, error: paidError } = await admin
    .from("charges")
    .select("customer_id, freight_amount, paid_at")
    .gt("freight_amount", 0)
    .eq("status", "approved")
    .gte("paid_at", `${periodStart}T00:00:00-03:00`)
    .lt("paid_at", `${periodEnd}T00:00:00-03:00`);

  if (paidError) {
    throw new Error(`Falha ao carregar o frete da semana: ${paidError.message}`);
  }

  const paidCustomers = new Set<string>();
  for (const row of paidRows ?? []) {
    if (!row.paid_at) continue;
    paidCustomers.add(row.customer_id as string);
    const value = Number(row.freight_amount) || 0;
    stats.total += value;
    const key = spWeekdayKey(row.paid_at);
    if (key) stats.byDay[key] += value;
  }
  stats.paidCount = paidCustomers.size;

  // Pendentes: tem lote no período e o frete do período não foi aprovado.
  const [lotsRes, coveredRes] = await Promise.all([
    admin
      .from("lots")
      .select("customer_id")
      .gte("auction_date", periodStart)
      .lt("auction_date", periodEnd),
    admin
      .from("charges")
      .select("customer_id")
      .gt("freight_amount", 0)
      .eq("freight_period", periodStart)
      .eq("status", "approved"),
  ]);

  if (lotsRes.error) {
    throw new Error(`Falha ao contar lotes do período: ${lotsRes.error.message}`);
  }
  if (coveredRes.error) {
    throw new Error(
      `Falha ao contar fretes pagos do período: ${coveredRes.error.message}`,
    );
  }

  const withLots = new Set((lotsRes.data ?? []).map((row) => row.customer_id as string));
  const covered = new Set(
    (coveredRes.data ?? []).map((row) => row.customer_id as string),
  );
  stats.pendingCount = [...withLots].filter((id) => !covered.has(id)).length;

  // BRL com 2 casas (somas de numeric chegam como string/number misto).
  stats.total = Math.round(stats.total * 100) / 100;
  (Object.keys(stats.byDay) as FreightDayKey[]).forEach((key) => {
    stats.byDay[key] = Math.round(stats.byDay[key] * 100) / 100;
  });

  return stats;
}
