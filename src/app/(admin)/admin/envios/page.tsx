import { ShipmentsView } from "@/components/admin/shipments/shipments-view";
import { listShipments, requireAdmin, type ShipmentPage } from "@/lib/dal";
import type { ShipmentStatus, ShipmentCostSummary } from "@/lib/shipments";
import { createClient } from "@/lib/supabase/server";
import { sfConfigured, sfSandbox } from "@/lib/superfrete";
import {
  getOrigin,
  getWebhookSecret,
  listShipmentQueue,
  nextShipmentDate,
  type ShipmentQueueRow,
} from "@/lib/shipments-server";

export const metadata = { title: "Envios" };

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

const VALID_STATUSES = [
  "all",
  "pending",
  "released",
  "posted",
  "delivered",
  "cancelled",
];

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async function EnviosPage({
  searchParams,
}: PageProps<"/admin/envios">) {
  await requireAdmin();

  const params = await searchParams;
  const q = first(params.q);
  const priceChanges = ["changed", "increase", "decrease"].includes(first(params.cost)) ? first(params.cost) as "changed" | "increase" | "decrease" : "all";
  const rawStatus = first(params.status) || "all";
  const status = VALID_STATUSES.includes(rawStatus) ? rawStatus : "all";
  const page = Math.max(1, Number(first(params.p)) || 1);

  // Fila: um único dia de envio (manual ou o próximo). Histórico: só quando
  // pedir explicitamente.
  const rawDate = first(params.d);
  const useQueue = first(params.vista) !== "historico";
  const date = ISO.test(rawDate) ? rawDate : await nextShipmentDate();

  let queue: ShipmentQueueRow[] = [];
  let queueTruncated = false;
  let data: ShipmentPage = { rows: [], total: 0, page, pageSize: 10 };
  let migrationReady = true;
  let migrationFile = "0006_shipments.sql";
  let summary: ShipmentCostSummary | null = null;
  try {
    if (useQueue) {
      const result = await listShipmentQueue({
        periodFrom: date,
        periodTo: date,
        q,
      });
      queue = result.rows;
      queueTruncated = result.truncated;
    } else {
      data = await listShipments({
        q,
        priceChanges,
        status: status as ShipmentStatus | "all",
        page,
        batchDate: ISO.test(rawDate) ? date : undefined,
      });
    }
    const summaryResult = await (await createClient()).rpc("get_shipment_cost_summary", {
      p_day: useQueue || ISO.test(rawDate) ? date : null,
      p_query: q.trim().replace(/[,\x27\x22%()\\]/g, " ").trim().slice(0, 64),
      p_status: useQueue ? "all" : status,
      p_cost: useQueue ? "all" : priceChanges,
    });
    if (!summaryResult.error) summary = summaryResult.data as ShipmentCostSummary;
  } catch (error) {
    if (error instanceof Error && /original_price|price_change_count|price_checked_at|price_difference|price_baseline_legacy/.test(error.message)) migrationFile = "0057_shipment_price_history.sql";
    if (
      error instanceof Error &&
      /does not exist|Could not find|shipments/i.test(error.message)
    ) {
      migrationReady = false;
    } else {
      throw error;
    }
  }

  const [originReady, webhookActive] = migrationReady
    ? [(await getOrigin()) !== null, (await getWebhookSecret()) !== null]
    : [false, false];

  return (
    <ShipmentsView
      {...data}
      queue={useQueue ? queue : null}
      queueTruncated={useQueue && queueTruncated}
      date={date}
      summary={summary}
      historyDateFiltered={!useQueue && ISO.test(rawDate)}
      q={q}
      status={status}
      priceChanges={priceChanges}
      migrationReady={migrationReady}
      migrationFile={migrationFile}
      originReady={originReady}
      superfreteReady={sfConfigured()}
      sandbox={sfSandbox()}
      webhookActive={webhookActive}
    />
  );
}
