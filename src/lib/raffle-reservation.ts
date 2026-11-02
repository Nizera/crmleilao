/** O prazo da reserva é independente do vencimento mínimo do Pix no provedor. */
export function raffleReservationDeadline(order: { reservation_expires_at?: string | null; created_at: string }): string {
  return order.reservation_expires_at || new Date(Date.parse(order.created_at) + 10 * 60_000).toISOString();
}
export function raffleReservationExpired(order: { reservation_expires_at?: string | null; created_at: string }, now = Date.now()): boolean {
  return Date.parse(raffleReservationDeadline(order)) <= now;
}
