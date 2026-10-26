/**
 * Tipos e utilitários dos envios (F4) — compartilhados entre servidor e
 * cliente. Sem dependência de servidor aqui (importável em "use client").
 */

export type ShipmentStatus =
  | "pending"
  | "released"
  | "posted"
  | "delivered"
  | "cancelled";

export const SHIPMENT_STATUSES: ShipmentStatus[] = [
  "pending",
  "released",
  "posted",
  "delivered",
  "cancelled",
];

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  pending: "Etiqueta pendente",
  released: "Aguardando postagem",
  posted: "Postado",
  delivered: "Entregue",
  cancelled: "Cancelado",
};

export type ShipmentVolume = {
  height: number;
  width: number;
  length: number;
  weight: number;
};

export type ShipmentLotRef = {
  id: string;
  code: string;
  title: string;
  auction_date?: string;
};

/** Snapshot do destinatário gravado na emissão da etiqueta. */
export type ShipmentAddress = {
  name: string;
  address: string;
  number?: string | null;
  complement?: string | null;
  district: string;
  city: string;
  state_abbr: string;
  postal_code: string;
  email?: string | null;
  phone?: string | null;
  document?: string | null;
};

export type Shipment = {
  id: string;
  code: string;
  customer_id: string;
  batch_date: string;
  status: ShipmentStatus;
  service_id: number | null;
  service_name: string | null;
  carrier: string | null;
  price: number | null;
  discount: number | null;
  delivery_time: number | null;
  insurance_value: number | null;
  volume: ShipmentVolume | null;
  address: ShipmentAddress | null;
  sf_order_id: string;
  tracking_code: string | null;
  tracking_url: string | null;
  label_print_url: string | null;
  paid_at: string | null;
  posted_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  customer?: { id: string; name: string | null; phone_e164: string } | null;
  lots?: ShipmentLotRef[];
};

/**
 * Dimensões prováveis do pacote pela quantidade de lotes (peso de envelope).
 * Ajustáveis na tela antes da cotação — a mesma caixa vai para cálculo e
 * etiqueta (exigência da SuperFrete).
 */
export function defaultShipmentVolume(lotCount: number): ShipmentVolume {
  const n = Math.max(1, lotCount);
  return {
    height: Math.min(30, 6 + (n - 1) * 3),
    width: 16,
    length: 23,
    weight: Number((0.2 + n * 0.1).toFixed(1)),
  };
}

/** Só antes da postagem dá para cancelar (regra da SuperFrete). */
export function canCancelShipment(status: ShipmentStatus): boolean {
  return status === "pending" || status === "released";
}

/** Etiqueta ainda não paga: ação é pagar (ou cancelar). */
export function canPayShipment(status: ShipmentStatus): boolean {
  return status === "pending";
}
