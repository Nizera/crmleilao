import type {ShipmentQueueRow} from "./shipments-server";

export function normalizeShipmentItemSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/\s+/g," ").trim();
}
export const shipmentSearchKey = (row: ShipmentQueueRow): string => row.pendingShipment ? `shipment:${row.pendingShipment.id}` : `customer:${row.customerId}`;
export function matchesShipmentItem(text: string, query: string): boolean {
  const normalized = normalizeShipmentItemSearch(text);
  return normalizeShipmentItemSearch(query).split(" ").filter(Boolean).every(word => normalized.includes(word));
}
