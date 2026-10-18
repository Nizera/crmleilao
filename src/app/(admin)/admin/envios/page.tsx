import { ShipmentsView } from "@/components/admin/shipments/shipments-view";
import { listShipments, requireAdmin, type ShipmentPage } from "@/lib/dal";
import type { ShipmentStatus } from "@/lib/shipments";
import { sfConfigured, sfSandbox } from "@/lib/superfrete";
import {
  getOrigin,
  getWebhookSecret,
  listShipmentQueue,
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

function shiftDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Semana de leilão corrente: terça a domingo. Sai na terça seguinte.
 * Ex.: terça 13/10 → 06/10 a 12/10. Domingo 18/10 → 12/10 a 18/10.
 * Usa UTC puro para não depender do fuso do servidor.
 */
function defaultPeriod(): { from: string; to: string } {
  const now = new Date();
  const iso = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
  const dow = now.getUTCDay();
  let to: string;
  if (dow === 0) to = iso;
  else if (dow === 1) to = shiftDays(iso, 6);
  else to = shiftDays(iso, -(dow - 1));
  return { from: shiftDays(to, -6), to };
}

export default async function EnviosPage({
  searchParams,
}: PageProps<"/admin/envios">) {
  await requireAdmin();

  const params = await searchParams;
  const q = first(params.q);
  const rawStatus = first(params.status) || "all";
  const status = VALID_STATUSES.includes(rawStatus) ? rawStatus : "all";
  const page = Math.max(1, Number(first(params.p)) || 1);

  // Fila: filtro de período (manual ou padrão). Histórico: só quando pedir explicitamente.
  const rawFrom = first(params.de);
  const rawTo = first(params.ate);
  const useQueue = first(params.vista) !== "historico";
  const fallback = defaultPeriod();
  const periodFrom = ISO.test(rawFrom) ? rawFrom : fallback.from;
  const periodTo = ISO.test(rawTo) ? rawTo : fallback.to;

  let queue: ShipmentQueueRow[] = [];
  let queueTruncated = false;
  let data: ShipmentPage = { rows: [], total: 0, page, pageSize: 10 };
  let migrationReady = true;
  try {
    if (useQueue) {
      const result = await listShipmentQueue({ periodFrom, periodTo, q });
      queue = result.rows;
      queueTruncated = result.truncated;
    } else {
      data = await listShipments({
        q,
        status: status as ShipmentStatus | "all",
        page,
      });
    }
  } catch (error) {
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
      periodFrom={periodFrom}
      periodTo={periodTo}
      q={q}
      status={status}
      migrationReady={migrationReady}
      originReady={originReady}
      superfreteReady={sfConfigured()}
      sandbox={sfSandbox()}
      webhookActive={webhookActive}
    />
  );
}
