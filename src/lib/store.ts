import { z } from "zod";

export type PriceMode = "coins" | "cash" | "mixed";
export type StoreProduct = {
  image_paths?: string[];
  sku?: string;
  category?: string;
  id: string;
  name: string;
  description: string | null;
  image_path: string | null;
  stock: number | null;
  points_cost: number | null;
  cash_price?: number | null;
  mixed_cash_price?: number | null;
  mixed_points_cost?: number | null;
};
export type CartLine = { reward_id: string; quantity: number; mode: PriceMode; expected_cash: number; expected_coins: number };
export const cartCheckoutSchema = z.object({
  requestKey: z.uuid(),
  items: z.array(z.object({
    reward_id: z.uuid(), quantity: z.number().int().min(1).max(99),
    mode: z.enum(["coins", "cash", "mixed"]),
    expected_cash: z.number().finite().min(0).max(9999999),
    expected_coins: z.number().finite().min(0).max(9999999),
  })).min(1).max(50),
});

export const coinNumber = (value: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
export const storeBRL = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
export function productPrices(product: StoreProduct) {
  const options: { mode: PriceMode; cash: number; coins: number }[] = [];
  if (Number(product.points_cost) > 0) options.push({ mode: "coins", cash: 0, coins: Number(product.points_cost) });
  if (Number(product.cash_price) > 0) options.push({ mode: "cash", cash: Number(product.cash_price), coins: 0 });
  if (Number(product.mixed_cash_price) > 0 && Number(product.mixed_points_cost) > 0)
    options.push({ mode: "mixed", cash: Number(product.mixed_cash_price), coins: Number(product.mixed_points_cost) });
  return options;
}
export function priceLabel(cash: number, coins: number) {
  return [cash > 0 ? storeBRL(cash) : null, coins > 0 ? `${coinNumber(coins)} Caracoins` : null].filter(Boolean).join(" + ");
}
export function safePixTicketUrl(raw: string | null): string | null {
  try { const url = new URL(raw ?? ""); return url.protocol === "https:" && ["mercadopago.com.br","mercadopago.com"].some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`)) ? url.href : null; }
  catch { return null; }
}
export function cartTotals(items: CartLine[]) {
  // Soma em centavos para evitar diferenças de ponto flutuante no resumo.
  return items.reduce((total, item) => ({
    cash: total.cash + Math.round(item.expected_cash * 100) * item.quantity,
    coins: total.coins + Math.round(item.expected_coins * 100) * item.quantity,
    quantity: total.quantity + item.quantity,
  }), { cash: 0, coins: 0, quantity: 0 });
}

export type StoreOrderItem = { id: string; reward_id: string; name: string; image_path: string | null; quantity: number; price_mode: PriceMode; unit_cash: number; unit_coins: number };
export type StoreOrder = {
  id: string; code: string; customer_id: string; external_reference: string;
  cash_total: number; coins_total: number;
  payment_status: "creating" | "pending" | "paid" | "cancelled" | "expired" | "failed" | "refunded" | "partially_refunded" | "payment_review";
  fulfillment_status: "awaiting" | "processing" | "fulfilled";
  mp_order_id: string | null; qr_code: string | null; qr_code_base64: string | null;
  ticket_url: string | null; expires_at: string | null; admin_note: string | null; created_at: string;
  items: StoreOrderItem[];
};
export const storePaymentLabels: Record<StoreOrder["payment_status"], string> = {
  creating: "Preparando Pix", pending: "Aguardando Pix", paid: "Pagamento confirmado",
  cancelled: "Cancelado", expired: "Pix expirado", failed: "Pagamento não concluído", refunded: "Pagamento devolvido",
  partially_refunded: "Devolução parcial · em análise pela equipe",
  payment_review: "Pagamento recebido · em análise pela equipe",
};
export const storeFulfillmentLabels = { awaiting: "Aguardando separação", processing: "Em separação", fulfilled: "Concluído" };
export const isStoreOrderOpen = (order: StoreOrder) => order.payment_status === "creating" || order.payment_status === "pending";
