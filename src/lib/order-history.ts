export const ORDER_HISTORY_PATH = "/admin/fidelidade/resgates";
export const orderStages = {
  all: "Todos", "to-fulfill": "Para separar", processing: "Em separação", unpaid: "Aguardando pagamento",
  fulfilled: "Concluídos", review: "Em análise", closed: "Encerrados",
} as const;
export type OrderStage = keyof typeof orderStages;
export type OrderHistoryFilters = { q: string; status: OrderStage; source: "all" | "store" | "legacy"; from: string; to: string; page: number; size: number };
export type HistoryOrder = {
  id: string; source: "store" | "legacy"; code: string; customer_id: string; customer_name: string | null;
  customer_phone: string | null; created_at: string; cash_total: number; coins_total: number;
  payment_status: import("./store").StoreOrder["payment_status"];
  fulfillment_status: import("./store").StoreOrder["fulfillment_status"];
  legacy_status: "pending" | "approved" | "fulfilled" | "rejected" | null;
  stage: Exclude<OrderStage,"all">; admin_note: string | null; customer_note: string | null;
  items: { id: string; name: string; quantity: number; unit_cash: number; unit_coins: number }[];
};
export type OrderHistoryData = { items: HistoryOrder[]; total: number; page: number; pages: number; size: number; counts: Record<OrderStage,number> };
const date = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s ? s : "";
export function orderHistoryFilters(params: Record<string,string | string[] | undefined>): OrderHistoryFilters {
  const one = (key: string) => (Array.isArray(params[key]) ? params[key][0] : params[key]) ?? "";
  const status = one("status"); const source = one("source");
  const from = date(one("from")); const to = date(one("to"));
  return { q: one("q").trim().slice(0,100), status: Object.hasOwn(orderStages,status) ? status as OrderStage : "all",
    source: source === "store" || source === "legacy" ? source : "all", from, to: from && to && to < from ? from : to,
    page: Math.max(1,Math.min(1000000,Math.trunc(Number(one("page"))) || 1)), size: [10,20,50].includes(Number(one("size"))) ? Number(one("size")) : 20 };
}
export function orderHistoryHref(filters: OrderHistoryFilters, changes: Partial<OrderHistoryFilters> = {}) {
  const f = { ...filters,...changes }; const p = new URLSearchParams();
  if(f.q) p.set("q",f.q); if(f.status !== "all") p.set("status",f.status); if(f.source !== "all") p.set("source",f.source);
  if(f.from) p.set("from",f.from); if(f.to) p.set("to",f.to); if(f.page > 1) p.set("page",String(f.page)); if(f.size !== 20) p.set("size",String(f.size));
  return ORDER_HISTORY_PATH + (p.size ? `?${p}` : "");
}
