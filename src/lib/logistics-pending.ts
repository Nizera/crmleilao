export const LOGISTICS_STATES = {
  open: "A separar",
  boxed: "Na caixa do cliente",
  shipping: "Etiqueta emitida",
  shipped: "Enviada",
  delivered: "Entregue",
  cancelled: "Cancelada",
} as const;
export type LogisticsState = keyof typeof LOGISTICS_STATES;
export type LogisticsPending = {
  id: string;
  code: string;
  customer_id: string;
  customer_name: string | null;
  phone_e164: string;
  title: string;
  quantity: number;
  reason: string;
  shipping_date: string;
  moved_at: string | null;
  shipment_id: string | null;
  shipment_code: string | null;
  tracking_code: string | null;
  state: LogisticsState;
  created_at: string;
};
