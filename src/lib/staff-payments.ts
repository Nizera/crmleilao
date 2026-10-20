import { z } from "zod";

/**
 * Fechamento do dia: registro manual do pagamento a cada membro da equipe.
 * O valor é digitado pelo dono — não existe regra automática de cálculo.
 */

export const staffPaymentSchema = z.object({
  staff_id: z.string().trim().min(1, "Selecione o membro da equipe."),
  payment_date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
  amount: z
    .number()
    .min(0, "Valor não pode ser negativo.")
    .max(999_999.99, "Valor alto demais para o fechamento."),
  notes: z.string().trim().max(200, "Observação longa demais.").optional(),
});

export type StaffPaymentValues = z.infer<typeof staffPaymentSchema>;

/**
 * Converte valor digitado no padrão brasileiro ("1.234,56") para número.
 * Devolve `null` quando não é parseável — a action responde com erro claro.
 */
export function parseMoney(raw: string | null | undefined): number | null {
  const clean = raw?.trim().replace(/[^\d.,-]/g, "") ?? "";
  if (!clean) return null;
  const normalized = clean.includes(",")
    ? clean.replace(/\./g, "").replace(",", ".")
    : clean;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Formata número como valor de input ("12,5"). */
export function moneyToInput(value: number): string {
  return value.toFixed(2).replace(/\.00$/, "").replace(".", ",");
}

/* --------------------------- dados do fechamento --------------------------- */

export type ClosingEntry = {
  code: string;
  title: string;
  customer: string;
  value: number;
  paidAt: string;
};

export type ClosingPendingCharge = {
  id: string;
  code: string;
  amount: number;
  customerName: string | null;
  phone_e164: string;
  ticketUrl: string | null;
  expiresAt: string | null;
};

export type ClosingStaffMember = {
  id: string;
  name: string | null;
  role: string;
  payment: { amount: number; notes: string | null } | null;
};

export type ClosingHistoryDay = {
  date: string;
  amount: number;
  count: number;
};

export type ClosingData = {
  date: string;
  receivedToday: number;
  entries: ClosingEntry[];
  pendingCharges: ClosingPendingCharge[];
  pendingTotal: number;
  staff: ClosingStaffMember[];
  history: ClosingHistoryDay[];
};
