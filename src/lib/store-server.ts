import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createPixOrder, getOrder, qrFrom, targetChargeStatus, type MpOrder } from "@/lib/mercadopago";
import { isStoreOrderOpen, type StoreOrder } from "@/lib/store";

export const STORE_ORDER_COLUMNS = "*, items:store_order_items(id,reward_id,name,image_path,quantity,price_mode,unit_cash,unit_coins)";
export async function getOwnStoreOrder(id: string, customerId: string): Promise<StoreOrder | null> {
  const db = await createClient();
  const { data, error } = await db.from("store_orders").select(STORE_ORDER_COLUMNS).eq("id", id).eq("customer_id", customerId).maybeSingle();
  if (error) throw error;
  return data as unknown as StoreOrder | null;
}
/** Chave idempotente estável: repetir a criação nunca gera outro Pix. */
export async function ensureStorePix(order: StoreOrder, signal = AbortSignal.timeout(20000)): Promise<StoreOrder> {
  if (!isStoreOrderOpen(order) || order.mp_order_id) return order;
  const admin = createAdminClient();
  const { data: customer, error: customerError } = await admin.from("customers").select("name,email,cpf_cnpj").eq("id", order.customer_id).single();
  if (customerError || !customer?.email?.trim()) throw new Error("Não foi possível carregar o e-mail do comprador.");
  const [firstName, ...lastName] = (customer.name || "Cliente").trim().split(/\s+/);
  const document = (customer.cpf_cnpj || "").replace(/\D/g, "");
  const payment = await createPixOrder({
    amount: Number(order.cash_total), description: `Loja Os Caras das Legends · ${order.code}`,
    externalReference: order.external_reference, payerEmail: customer.email.trim(),
    payerFirstName: firstName, payerLastName: lastName.join(" ") || undefined,
    identification: document.length === 11 || document.length === 14 ? { type: document.length === 11 ? "CPF" : "CNPJ", number: document } : undefined,
  }, { waitForQr: false, signal });
  if (Math.round(payment.amount * 100) !== Math.round(Number(order.cash_total) * 100)) throw new Error("Valor divergente no pagamento da loja.");
  // Um webhook pode confirmar entre a criação e a persistência. Nunca rebaixa um pedido pago.
  const values = { mp_order_id: payment.orderId, qr_code: payment.qrCode, qr_code_base64: payment.qrCodeBase64, ticket_url: payment.ticketUrl, expires_at: payment.dateOfExpiration, updated_at: new Date().toISOString() };
  const { error } = await admin.from("store_orders").update(values).eq("id", order.id).or(`mp_order_id.is.null,mp_order_id.eq.${payment.orderId}`);
  if (error) throw error;
  const { error: pendingError } = await admin.from("store_orders").update({ payment_status: "pending" }).eq("id", order.id).eq("payment_status", "creating");
  if (pendingError) throw pendingError;
  // O ID é salvo antes de qualquer espera pelo QR. A sincronização seguinte usa GET.
  return { ...order, ...values, payment_status: "pending" };
}

/** Usado exclusivamente com a resposta autenticada da API do MP. */
export async function settleStoreMpOrder(payment: MpOrder) {
  if (!payment.externalReference?.startsWith("shop_")) return { ok: true, reason: "ignored" };
  const target = targetChargeStatus(payment.status, payment.statusDetail);
  if (!target) return { ok: true, reason: "pending" };
  const status = payment.statusDetail === "partially_refunded" ? "partially_refunded" : target === "approved" ? "paid" : target === "rejected"
    ? (["refunded", "charged_back"].includes(payment.status) ? "refunded" : "failed") : target;
  const admin = createAdminClient();
  const { error } = await admin.rpc("settle_store_payment", {
    p_reference: payment.externalReference, p_mp_order_id: payment.id,
    p_amount: payment.amount, p_status: status, p_paid_at: payment.dateApproved,
  });
  if (error) throw error;
  return { ok: true };
}
export async function syncStoreOrder(order: StoreOrder, signal?: AbortSignal) {
  if (!order.mp_order_id) return;
  const payment = await getOrder(order.mp_order_id, signal);
  if (!payment || payment.externalReference !== order.external_reference || Math.round(payment.amount * 100) !== Math.round(Number(order.cash_total) * 100)) throw new Error("Pagamento não localizado ou divergente para este pedido.");
  const qr = qrFrom(payment.raw);
  if (qr.qrCode || qr.ticketUrl) {
    const admin = createAdminClient();
    const expiresAt = payment.raw.transactions?.payments?.[0]?.date_of_expiration ?? payment.raw.date_of_expiration;
    const { error } = await admin.from('store_orders').update({
      ...(qr.qrCode ? { qr_code: qr.qrCode, qr_code_base64: qr.qrCodeBase64 } : {}),
      ...(qr.ticketUrl ? { ticket_url: qr.ticketUrl } : {}),
      ...(expiresAt ? { expires_at: expiresAt } : {}),
    }).eq('id', order.id).eq('mp_order_id', payment.id);
    if (error) throw error;
  }
  await settleStoreMpOrder(payment);
}

/** Chamado por cron autenticado e pelo ADM; nunca libera reservas pelo relógio local. */
export async function reconcileStoreOrders() {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('claim_store_reconciliation', { p_limit: 10 });
  if (error) throw error;
  const results = await Promise.all((data ?? []).map(async (row: StoreOrder) => {
    try {
      const signal = AbortSignal.timeout(25000);
      const order = await ensureStorePix(row, signal);
      await syncStoreOrder(order, signal);
      await admin.from('store_orders').update({ reconciliation_error: null }).eq('id', row.id);
      return true;
    } catch {
      await admin.from('store_orders').update({ reconciliation_error: 'Não foi possível confirmar com o Mercado Pago. A reserva foi mantida por segurança.' }).eq('id', row.id);
      return false;
    }
  }));
  return { checked: results.length, failed: results.filter(result => !result).length };
}
