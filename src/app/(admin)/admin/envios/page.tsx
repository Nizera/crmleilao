import { ShipmentsView } from "@/components/admin/shipments/shipments-view";
import { listShipments, requireAdmin, type ShipmentPage } from "@/lib/dal";
import type { ShipmentStatus } from "@/lib/shipments";
import { sfConfigured, sfSandbox } from "@/lib/superfrete";
import { getOrigin, getWebhookSecret } from "@/lib/shipments-server";

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

export default async function EnviosPage({
  searchParams,
}: PageProps<"/admin/envios">) {
  await requireAdmin();

  const params = await searchParams;
  const q = first(params.q);
  const rawStatus = first(params.status) || "all";
  const status = VALID_STATUSES.includes(rawStatus) ? rawStatus : "all";
  const page = Math.max(1, Number(first(params.p)) || 1);

  let data: ShipmentPage = { rows: [], total: 0, page, pageSize: 10 };
  let migrationReady = true;
  try {
    data = await listShipments({
      q,
      status: status as ShipmentStatus | "all",
      page,
    });
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
