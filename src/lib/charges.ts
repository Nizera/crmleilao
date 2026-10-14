import { z } from "zod";
import { formatBRL, type LotStatus } from "@/lib/lots";
import { DEFAULT_SETTINGS, renderTemplate } from "@/lib/settings";

export const CHARGE_STATUSES = [
  "pending",
  "in_process",
  "approved",
  "cancelled",
  "expired",
  "rejected",
] as const;

export type ChargeStatus = (typeof CHARGE_STATUSES)[number];

export const CHARGE_STATUS_LABELS: Record<ChargeStatus, string> = {
  pending: "Aguardando pagamento",
  in_process: "Em processamento",
  approved: "Pago",
  cancelled: "Cancelada",
  expired: "Expirada",
  rejected: "Recusada",
};

export type ChargeCustomerRef = {
  id: string;
  name: string | null;
  phone_e164: string;
};

export type ChargeLotRef = {
  id: string;
  code: string;
  title: string;
  arremate_value: number;
  status: LotStatus;
};

export type Charge = {
  id: string;
  code: string;
  customer_id: string;
  amount: number;
  status: ChargeStatus;
  mp_payment_id: string | null;
  external_reference: string;
  description: string | null;
  qr_code: string | null;
  qr_code_base64: string | null;
  ticket_url: string | null;
  expires_at: string | null;
  paid_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  customer?: ChargeCustomerRef | null;
  lots?: ChargeLotRef[];
};

/** Cobrança "aberta" no banco: ainda pode transicionar de status. */
export const isChargeOpen = (status: ChargeStatus) =>
  status === "pending" || status === "in_process";

/**
 * Cobrança ainda "aberta": os lotes vinculados continuam bloqueados para
 * nova cobrança. Uma cobrança pending cujo `expires_at` já passou conta como
 * expirada localmente (o webhook do MP pode demorar a chegar).
 */
export function isChargeActive(
  charge: Pick<Charge, "status" | "expires_at">,
  now: Date = new Date(),
): boolean {
  if (!isChargeOpen(charge.status)) return false;
  if (charge.expires_at && new Date(charge.expires_at).getTime() < now.getTime()) {
    return false;
  }
  return true;
}

/** QR do Mercado Pago veio como base64 puro; aqui vira data URL para o <img>. */
export function chargeQRDataUrl(base64: string | null | undefined): string | null {
  if (!base64) return null;
  if (base64.startsWith("data:")) return base64;
  return `data:image/png;base64,${base64}`;
}

/**
 * Mensagem de cobrança para o WhatsApp.
 * {code} = códigos dos lotes cobrados (ou o código da cobrança, se não houver
 * lotes anexados), {link} = página de pagamento do Mercado Pago.
 */
export function buildChargeMessage(
  charge: Charge,
  template?: string,
): string {
  const codes =
    charge.lots && charge.lots.length > 0
      ? charge.lots.map((lot) => lot.code).join(", ")
      : charge.code;

  return renderTemplate(template ?? DEFAULT_SETTINGS.wa_payment_template, {
    name: charge.customer?.name ?? "",
    code: codes,
    value: formatBRL(charge.amount),
    link: charge.ticket_url ?? "",
    charge: charge.code,
  });
}

export const chargeCreateSchema = z.object({
  customer_id: z.string().trim().min(1, "Selecione o cliente"),
  lot_ids: z
    .array(z.string().trim().min(1))
    .min(1, "Selecione ao menos um lote"),
});

/** Lê `lot_ids` de um FormData (JSON no campo), como parseLotItems. */
export function parseChargeLotIds(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
  } catch {
    return [];
  }
}
