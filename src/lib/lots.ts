import { z } from "zod";
import { spToday } from "@/lib/dates";
import { DEFAULT_SETTINGS, renderTemplate } from "@/lib/settings";
import type { LotItemRow } from "@/lib/stock";

export const LOT_STATUSES = [
  "pending_payment",
  "paid",
  "shipped",
  "delivered",
  "cancelled",
] as const;

export type LotStatus = (typeof LOT_STATUSES)[number];

export const LOT_STATUS_LABELS: Record<LotStatus, string> = {
  pending_payment: "Aguardando pagamento",
  paid: "Pago",
  shipped: "Enviado",
  delivered: "Entregue",
  cancelled: "Cancelado",
};

export type LotRow = {
  id: string;
  code: string;
  customer_id: string;
  title: string;
  description: string | null;
  images: string[];
  arremate_value: number;
  status: LotStatus;
  /** Cobrança que está cobrando este lote (nula quando elegível para nova cobrança). */
  charge_id: string | null;
  auction_date: string;
  shipping_date: string | null;
  paid_at: string | null;
  shipped_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type LotCustomer = {
  id: string;
  name: string | null;
  phone_e164: string;
  /** Preenchido quando o cliente já criou a senha e entrou no painel. */
  auth_user_id?: string | null;
};

export type Lot = LotRow & {
  customer: LotCustomer | null;
  /** Composição do lote (figurinhas baixadas do estoque). Preenchido pela F2. */
  items?: LotItemRow[];
};

export const isTerminalStatus = (status: LotStatus) =>
  status === "delivered" || status === "cancelled";

export function nextShippingDate(isoDate: string, weekday = 2): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;

  const target = Math.min(6, Math.max(0, Math.trunc(weekday)));
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay();
  let delta = (target - dow + 7) % 7;
  if (delta === 0) delta = 7;

  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

export function todayISO(): string {
  return spToday();
}

export function formatDateBR(isoDate: string | null): string {
  if (!isoDate) return "—";
  const [y, m, d] = isoDate.split("-");
  if (!y || !m || !d) return isoDate;
  return `${d}/${m}/${y}`;
}

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatBRL(value: number | string | null): string {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (numeric == null || Number.isNaN(numeric)) return "—";
  return brl.format(numeric);
}

export function lotImageUrl(path: string | null | undefined): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base || !path) return null;
  return `${base.replace(/\/+$/, "")}/storage/v1/object/public/lot-images/${path}`;
}

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(
    /\/+$/,
    "",
  );
}

export function lotDeepLink(code: string): string {
  return `${siteUrl()}/painel/lotes/${code}`;
}

export function waMessageLink(phoneE164: string, text: string): string {
  const digits = phoneE164.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** Texto pronto no WhatsApp sem destino fixo — abre o seletor de contato. */
export function waShareLink(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function buildLotMessage(lot: Lot, template?: string): string {
  return renderTemplate(template ?? DEFAULT_SETTINGS.wa_notice_template, {
    code: lot.code,
    title: lot.title,
    value: formatBRL(lot.arremate_value),
    shipping: formatDateBR(lot.shipping_date),
    link: lotDeepLink(lot.code),
    name: lot.customer?.name ?? "",
  });
}

export const lotSchema = z.object({
  id: z.string().optional(),
  customer_id: z.string().optional(),
  phone: z.string().trim().optional(),
  customer_name: z.string().trim().max(120).optional(),
  title: z.string().trim().min(1, "Informe o título do lote").max(160),
  description: z.string().trim().max(4000).optional(),
  arremate_value: z
    .string()
    .trim()
    .regex(
      /^\d{1,9}([.,]\d{1,2})?$/,
      "Valor inválido, use algo como 45 ou 45,50",
    ),
  auction_date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data do leilão inválida"),
  shipping_date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data de envio inválida")
    .optional()
    .or(z.literal("")),
  status: z.enum(LOT_STATUSES),
  notes: z.string().trim().max(4000).optional(),
});

export type LotFormValues = z.input<typeof lotSchema>;

/** Novo lote exige telefone, a menos que um cliente já esteja selecionado. */
export const lotFormSchema = lotSchema.refine(
  (values) => Boolean(values.customer_id) || Boolean(values.phone?.trim()),
  { message: "Informe o WhatsApp do cliente com DDD", path: ["phone"] },
);
