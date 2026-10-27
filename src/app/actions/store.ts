"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, requireCustomer } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { allow } from "@/lib/ratelimit";
import { rethrowIfRedirect, type ActionResult } from "@/lib/result";
import { cartCheckoutSchema, isStoreOrderOpen, type StoreOrder } from "@/lib/store";
import { ensureStorePix, getOwnStoreOrder, reconcileStoreOrders, STORE_ORDER_COLUMNS, syncStoreOrder } from "@/lib/store-server";
import { cancelPixOrder } from "@/lib/mercadopago";
import { STORE_PREVIEW_ONLY, STORE_PREVIEW_MESSAGE } from '@/lib/store-availability';

function invalidateStore() {
  revalidatePath("/painel", "layout");
  revalidatePath("/admin/fidelidade");
  revalidatePath("/admin/fidelidade/resgates");
  revalidatePath("/admin/fidelidade/recompensas");
}
function failed(error: unknown): ActionResult<never> {
  rethrowIfRedirect(error);
  console.error("[store]", error instanceof Error ? error.message : "Falha na loja");
  return { ok: false, error: "Não foi possível concluir agora. Se o pedido foi criado, ele continua salvo abaixo para retomar sem cobrar novamente." };
}
const domainError = (message: string) => /^(Você já tem|A loja está|Saldo de Caracoins|Estoque insuficiente|Um produto|Modalidade|Preencha seu|O preço|Carrinho inválido|Produto duplicado|O carrinho deve)/.test(message);

export async function checkoutStoreAction(input: unknown): Promise<ActionResult<StoreOrder>> {
  try {
    const { customer } = await requireCustomer();
    if (STORE_PREVIEW_ONLY) return {ok:false,error:STORE_PREVIEW_MESSAGE};
    const parsed = cartCheckoutSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Revise os produtos e quantidades do carrinho." };
    if (!await allow("store-checkout", customer.id)) return { ok: false, error: "Aguarde um pouco antes de tentar novamente." };
    const db = await createClient();
    const { data: id, error } = await db.rpc("checkout_store_cart", { p_request_key: parsed.data.requestKey, p_items: parsed.data.items });
    if (error) {
      if (domainError(error.message)) return { ok: false, error: error.message };
      throw error;
    }
    let order = await getOwnStoreOrder(String(id), customer.id);
    if (!order) throw new Error("Pedido não encontrado após checkout.");
    // A reserva já está salva. Falha de rede no MP não desfaz nem duplica o pedido.
    try { await ensureStorePix(order); } catch (error) { console.error("[store] Pix pendente de retomada:", error instanceof Error ? error.message : "erro"); }
    order = await getOwnStoreOrder(order.id, customer.id);
    if (!order) throw new Error("Pedido não encontrado.");
    invalidateStore();
    return { ok: true, data: order };
  } catch (error) { return failed(error); }
}

export async function syncSelfStoreOrderAction(id: string): Promise<ActionResult<StoreOrder>> {
  try {
    const { customer } = await requireCustomer();
    if (!z.uuid().safeParse(id).success) return { ok: false, error: "Pedido inválido." };
    if (!await allow("store-sync", customer.id)) return { ok: false, error: "Aguarde alguns segundos para consultar novamente." };
    const order = await getOwnStoreOrder(id, customer.id);
    if (!order) return { ok: false, error: "Pedido não encontrado." };
    if (isStoreOrderOpen(order)) { await ensureStorePix(order); await syncStoreOrder(await getOwnStoreOrder(id, customer.id) ?? order); }
    const updated = await getOwnStoreOrder(id, customer.id);
    if (!updated) throw new Error("Pedido não encontrado.");
    if (updated.payment_status !== order.payment_status) invalidateStore();
    return { ok: true, data: updated };
  } catch (error) { return failed(error); }
}

export async function cancelSelfStoreOrderAction(id: string): Promise<ActionResult<StoreOrder>> {
  try {
    const { customer } = await requireCustomer();
    if (!z.uuid().safeParse(id).success) return { ok: false, error: "Pedido inválido." };
    if (!await allow("store-checkout", customer.id)) return { ok: false, error: "Aguarde um pouco antes de tentar novamente." };
    let order = await getOwnStoreOrder(id, customer.id);
    if (!order || !isStoreOrderOpen(order)) return { ok: false, error: "Este pedido não possui Pix aberto para cancelar." };
    await ensureStorePix(order);
    order = await getOwnStoreOrder(id, customer.id);
    if (!order?.mp_order_id) throw new Error("Pix ainda sem identificação; retome o pagamento antes de cancelar.");
    await syncStoreOrder(order);
    const beforeCancel = await getOwnStoreOrder(id, customer.id);
    if (beforeCancel && isStoreOrderOpen(beforeCancel)) {
      // Só libera moedas/estoque quando a RECONSULTA confirmar o cancelamento.
      await cancelPixOrder(order.mp_order_id);
      await syncStoreOrder(order);
    }
    const updated = await getOwnStoreOrder(id, customer.id);
    if (!updated || isStoreOrderOpen(updated)) return { ok: false, error: "O Mercado Pago ainda não confirmou o cancelamento. O pedido continua reservado; tente novamente." };
    invalidateStore();
    return { ok: true, data: updated };
  } catch (error) { return failed(error); }
}

export async function handleStoreOrderAction(form: FormData): Promise<ActionResult> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role === "viewer") return { ok: false, error: "Seu perfil é somente leitura." };
    const id = String(form.get("order_id") ?? "");
    const status = String(form.get("status") ?? "");
    if (!z.uuid().safeParse(id).success || !["processing", "boxed", "fulfilled", "cancelled"].includes(status)) return { ok: false, error: "Pedido ou ação inválidos." };
    const db = await createClient();
    const { error } = await db.rpc("handle_store_order", { p_order_id: id, p_status: status, p_note: String(form.get("note") ?? "").trim().slice(0,500) });
    if (error) return { ok: false, error: "Não foi possível movimentar. Confira se o pedido está pago e ainda não foi concluído." };
    invalidateStore();
    revalidatePath('/admin/relatorios');
    revalidatePath('/admin/envios');
    return { ok: true, data: null };
  } catch (error) { return failed(error); }
}

export async function reconcileStoreOrdersAction(): Promise<ActionResult<{checked:number;failed:number}>> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role === 'viewer' || !await allow('store-sync', profile.id)) return {ok:false,error:'Sem permissão ou limite de consultas atingido.'};
    const result = await reconcileStoreOrders();
    invalidateStore();
    return {ok:true,data:result};
  } catch (error) { return failed(error); }
}

export async function syncAdminStoreOrderAction(id: string): Promise<ActionResult> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role === "viewer") return { ok: false, error: "Seu perfil é somente leitura." };
    if (!z.uuid().safeParse(id).success) return { ok: false, error: "Pedido inválido." };
    if (!await allow("store-sync", profile.id)) return { ok: false, error: "Aguarde alguns segundos para consultar novamente." };
    const db = await createClient();
    const { data, error } = await db.from("store_orders").select(STORE_ORDER_COLUMNS).eq("id", id).single();
    if (error || !data) return { ok: false, error: "Pedido não encontrado." };
    const order = data as unknown as StoreOrder;
    if (isStoreOrderOpen(order)) await ensureStorePix(order);
    await syncStoreOrder(await getOwnStoreOrder(id,order.customer_id) ?? order);
    invalidateStore();
    return { ok: true, data: null };
  } catch (error) { return failed(error); }
}
