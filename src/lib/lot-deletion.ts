import type { LotRow } from "@/lib/lots";

export function lotDeletionBlock(lot: Pick<LotRow, "status" | "paid_at" | "charge_id" | "auction_voucher_id" | "voucher_amount" | "shipped_at" | "moved_at">): string | null {
  if (!["pending_payment", "cancelled"].includes(lot.status) || lot.paid_at) return "Lotes pagos não podem ser excluídos.";
  if (lot.charge_id) return "Resolva a cobrança antes de excluir este lote.";
  if (lot.auction_voucher_id || Number(lot.voucher_amount) > 0) return "Resolva o voucher antes de excluir este lote.";
  if (lot.shipped_at || lot.moved_at) return "Este lote já foi separado ou enviado.";
  return null;
}
