import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPixOrder, getOrder, qrFrom, targetChargeStatus, type MpOrder } from "@/lib/mercadopago";
import type { RaffleOrder } from "@/lib/raffles";

export async function rafflesEnabled() {
  const { data, error } = await (await createClient()).from("raffle_settings").select("purchases_enabled").eq("id", true).single();
  return !error && data?.purchases_enabled === true;
}
export async function ownRaffleOrder(id: string, customer: string) {
  const { data, error } = await (await createClient()).from("raffle_orders").select("*,campaign:raffle_campaigns(total_numbers)").eq("id", id).eq("customer_id", customer).maybeSingle();
  if (error) throw error;
  return data ? { ...data, total_numbers: data.campaign?.total_numbers } as RaffleOrder : null;
}
export async function ensureRafflePix(order: RaffleOrder, signal?: AbortSignal) {
  if (order.mp_order_id || !["creating", "pending"].includes(order.status)) return;
  const admin = createAdminClient();
  const { data: customer, error } = await admin.from("customers").select("email").eq("id", order.customer_id).single();
  if (error || !customer?.email) throw new Error("Comprador indisponível.");
  const payment = await createPixOrder({ amount: Number(order.amount), description: `Rifa Os Caras das Legends · ${order.code}`, externalReference: order.external_reference, payerEmail: customer.email }, { waitForQr: false, signal });
  if (Math.round(payment.amount * 100) !== Math.round(Number(order.amount) * 100)) throw new Error("Pagamento divergente.");
  const { error: saveError } = await admin.from("raffle_orders").update({ mp_order_id: payment.orderId, qr_code: payment.qrCode, qr_code_base64: payment.qrCodeBase64, expires_at: payment.dateOfExpiration }).eq("id", order.id).or(`mp_order_id.is.null,mp_order_id.eq.${payment.orderId}`);
  if (saveError) throw saveError;
  const { error: pendingError } = await admin.from("raffle_orders").update({ status: "pending" }).eq("id", order.id).eq("status", "creating");
  if (pendingError) throw pendingError;
}
/** A única entrada de liquidação é uma consulta autenticada à API do provedor. */
export async function settleRafflePayment(payment: MpOrder) {
  if (!payment.externalReference?.startsWith("raffle_")) return;
  const target = targetChargeStatus(payment.status, payment.statusDetail);
  if (!target) return;
  const review = ["refunded", "charged_back"].includes(payment.status) || payment.statusDetail === "partially_refunded";
  const status = review ? "review" : target === "approved" ? "paid" : target === "rejected" ? "failed" : target;
  const { error } = await createAdminClient().rpc("settle_raffle_payment", { p_reference: payment.externalReference, p_mp_id: payment.id, p_amount: payment.amount, p_status: status });
  if (error) throw error;
}
export async function syncRafflePayment(order: RaffleOrder, signal?: AbortSignal) {
  if (!order.mp_order_id) return;
  const payment = await getOrder(order.mp_order_id, signal);
  if (!payment || payment.externalReference !== order.external_reference || Math.round(payment.amount * 100) !== Math.round(Number(order.amount) * 100)) throw new Error("Pagamento divergente.");
  const qr = qrFrom(payment.raw);
  if (qr.qrCode) {
    const { error } = await createAdminClient().from("raffle_orders").update({ qr_code: qr.qrCode, qr_code_base64: qr.qrCodeBase64 }).eq("id", order.id).eq("mp_order_id", payment.id);
    if (error) throw error;
  }
  await settleRafflePayment(payment);
}

export async function reconcileRafflePayments(budget = 18000) {
  const admin = createAdminClient(); const deadline = Date.now() + budget; let checked = 0; let failed = 0;
  for (let batch = 0; batch < 10 && Date.now() < deadline - 1000; batch++) {
    const { data, error } = await admin.rpc("claim_raffle_reconciliation");
    if (error?.code === "PGRST202") return { checked, failed };
    if (error) throw error;
    if (!data?.length) break;
    const results = await Promise.all((data as RaffleOrder[]).map(async order => {
      try {
        const signal = AbortSignal.timeout(Math.max(500, deadline - Date.now()));
        await ensureRafflePix(order, signal);
        const { data: latest, error } = await admin.from("raffle_orders").select("*").eq("id", order.id).single();
        if (error) throw error;
        await syncRafflePayment(latest as RaffleOrder, signal);
        return true;
      } catch { return false; }
    }));
    checked += results.length; failed += results.filter(v => !v).length;
  }
  return { checked, failed };
}
