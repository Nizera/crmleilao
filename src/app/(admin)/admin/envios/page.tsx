import {findShipmentItems} from "@/lib/shipment-item-search-server";
import {unifiedShipmentRows} from "@/lib/shipment-list";
import { ShipmentsView } from "@/components/admin/shipments/shipments-view";
import { listShipments, requireAdmin, type ShipmentPage } from "@/lib/dal";
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
  const itemQuery = first(params.item).trim().slice(0,160);
  const priceChanges = ["changed", "increase", "decrease"].includes(first(params.cost)) ? first(params.cost) as "changed" | "increase" | "decrease" : "all";
  const rawStatus = first(params.status) || "all";
  const status = VALID_STATUSES.includes(rawStatus) ? rawStatus : "all";
  const page = Math.max(1, Number(first(params.p)) || 1);

  // Uma lista por data prevista: etiquetas e pacotes ainda sem emissão.
  const rawDate = first(params.d);
  const useQueue = true;
  const date = ISO.test(rawDate) ? rawDate : await nextShipmentDate();

  let queue: ShipmentQueueRow[] = [];
  let queueTruncated = false;
  let data: ShipmentPage = { rows: [], total: 0, page, pageSize: 10 };
  let migrationReady = true;
  let migrationFile = "0006_shipments.sql";
  try {
    if (useQueue) {
      const result = await listShipmentQueue({
        periodFrom: date,
        periodTo: date,
        q,
      });
      queue = result.rows;
      queueTruncated = result.truncated;
    }
    {
      data = await listShipments({
        q,
        priceChanges: "all",
        status: "all",
        page: 1,
        pageSize: 50,
        batchDate: useQueue || ISO.test(rawDate) ? date : undefined,
      });
    }
    const labelRows = [...data.rows];
    for (let labelPage = 2; labelRows.length < data.total && labelPage <= 40; labelPage++) {
      const next = await listShipments({q, status: "all", page: labelPage, pageSize: 50, batchDate: useQueue || ISO.test(rawDate) ? date : undefined});
      if (!next.rows.length) break;
      labelRows.push(...next.rows);
    }
    queueTruncated ||= labelRows.length < data.total;
    data = {...data, rows: labelRows};
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

  const itemMatches = migrationReady && itemQuery ? await findShipmentItems(unifiedShipmentRows(queue,data.rows),itemQuery,date) : null;
  return (
    <ShipmentsView
      itemQuery={itemQuery}
      itemMatches={itemMatches}
      {...data}
      queue={queue}
      queueTruncated={useQueue && queueTruncated}
      date={date}
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
