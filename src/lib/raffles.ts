import { z } from "zod";
import { isIsoDay } from "@/lib/dates";

export const raffleSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(10).max(6000),
  total_numbers: z.coerce.number().int().min(2).max(10000),
  unit_price: z.coerce.number().positive().max(10000).transform(n => Math.round(n * 100) / 100),
  selection_mode: z.enum(["both", "manual", "automatic"]),
  draw_method: z.enum(["external", "federal"]),
  draw_rules: z.string().trim().min(10).max(2000),
  shipping_date: z.preprocess(value => value === "" || value == null ? null : value, z.string().refine(isIsoDay, "Informe uma data válida.").nullable()),
  image_url: z.union([z.literal(""), z.url().refine(v => v.startsWith("https://"), "Use uma imagem HTTPS.")]),
  hide_winning_numbers: z.boolean(),
  min_quantity: z.coerce.number().int().min(1).max(1000),
  max_quantity: z.coerce.number().int().min(1).max(1000),
}).refine(v => v.min_quantity <= v.max_quantity && v.max_quantity <= v.total_numbers, "Revise os limites de cotas.");

export type Raffle = z.infer<typeof raffleSchema> & { id: string; status: string; created_at: string; archived_at?: string | null };
export type RaffleOrder = { id: string; campaign_id: string; customer_id: string; code: string; amount: number; status: string; numbers: number[]; created_at: string; expires_at: string | null; external_reference: string; mp_order_id: string | null; qr_code: string | null; qr_code_base64: string | null; campaign_title?: string; total_numbers?: number; customer_name?: string };
export type RaffleAward = { order_status?: string; id: string; campaign_id: string; order_id: string | null; customer_id: string; title: string; number: number; total_numbers?: number; campaign_title: string; kind: string; logistics_id: string; moved_at: string | null; shipment_id: string | null; tracking_code: string | null; shipment_status: string | null; cancelled_at: string | null };
export const quotaLabel = (number: number, total = 1000) => String(number).padStart(Math.max(3, String(total - 1).length), "0");
export const raffleMoney = (value: number) => Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const raffleStatus: Record<string, string> = { draft: "Rascunho", open: "Em andamento", paused: "Pausada", closed: "Encerrada", creating: "Preparando Pix", pending: "Aguardando pagamento", paid: "Pago", cancelled: "Cancelado", expired: "Expirado", failed: "Não aprovado", review: "Em análise" };
