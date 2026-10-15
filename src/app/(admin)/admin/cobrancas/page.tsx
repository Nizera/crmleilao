import { ChargesView } from "@/components/admin/charges/charges-view";
import { getAppSettings, listCharges, requireAdmin, type ChargePage } from "@/lib/dal";
import {
  mpConfigured,
  mpSignatureConfigured,
  mpWebhookConfigured,
} from "@/lib/mercadopago";
import type { ChargeStatus } from "@/lib/charges";

export const metadata = { title: "Cobranças" };

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

const VALID_STATUSES = [
  "all",
  "pending",
  "in_process",
  "approved",
  "cancelled",
  "expired",
  "rejected",
];

export default async function CobrancasPage({
  searchParams,
}: PageProps<"/admin/cobrancas">) {
  await requireAdmin();

  const params = await searchParams;
  const q = first(params.q);
  const rawStatus = first(params.status) || "all";
  const status = VALID_STATUSES.includes(rawStatus) ? rawStatus : "all";
  const page = Math.max(1, Number(first(params.p)) || 1);

  const { settings } = await getAppSettings();

  let data: ChargePage = { rows: [], total: 0, page, pageSize: 10 };
  let migrationReady = true;
  try {
    data = await listCharges({
      q,
      status: status as ChargeStatus | "all",
      page,
    });
  } catch (error) {
    if (error instanceof Error && /does not exist|charges/i.test(error.message)) {
      migrationReady = false;
    } else {
      throw error;
    }
  }

  return (
    <ChargesView
      {...data}
      q={q}
      status={status}
      paymentTemplate={settings.wa_payment_template}
      mpReady={mpConfigured()}
      webhookReady={mpWebhookConfigured()}
      signatureReady={mpSignatureConfigured()}
      migrationReady={migrationReady}
    />
  );
}
