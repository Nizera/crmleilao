import "server-only";
import { cancelCharge, getChargeById } from "@/lib/charges-server";

export type LotPaymentSnapshot = {
  status: string;
  paid_at: string | null;
  charge_id: string | null;
  arremate_value?:number;
  voucher_amount?:number;
  moved_at?:string|null;
};

/** Chamado apenas depois do requireAdmin, antes de qualquer alteração financeira. */
export async function prepareLotFinancialChange(lot: LotPaymentSnapshot): Promise<void> {
  if (lot.status === "paid" && Number(lot.arremate_value) === 0 && Number(lot.voucher_amount) > 0 && !lot.paid_at && !lot.charge_id && !lot.moved_at) return;
  if (lot.paid_at || ["paid", "shipped", "delivered"].includes(lot.status)) {
    throw new Error("Este lote já foi pago. Alterar valor, trocar cliente ou cancelar exige tratar o ajuste/reembolso primeiro. O histórico foi preservado.");
  }
  if (!lot.charge_id) return;
  const charge = await getChargeById(lot.charge_id);
  if (!charge) throw new Error("Não foi possível conferir a cobrança deste lote.");
  if (charge.status === "approved") throw new Error("O Pix deste lote já foi pago. Sincronize a cobrança antes de fazer qualquer ajuste.");
  if (charge.status !== "pending" && charge.status !== "in_process") {
    throw new Error("O lote ainda está vinculado a uma cobrança encerrada. Sincronize os dados antes de editar.");
  }
  const result = await cancelCharge(charge.id);
  if (!result.ok) {
    if (result.reason === "already_approved") throw new Error("O Pix foi pago durante a alteração. O pagamento foi preservado; atualize a tela.");
    throw new Error("Não foi possível confirmar o cancelamento do Pix no Mercado Pago. O lote não foi alterado. Confira a cobrança e tente novamente.");
  }
}
