"use server";

import {isLocalStorePilot,storePurchasesEnabled} from "@/lib/store-settings-server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, requireCustomer } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import { allow } from "@/lib/ratelimit";
import { rethrowIfRedirect, type ActionResult } from "@/lib/result";
import { cartCheckoutSchema, isStoreOrderOpen, type StoreOrder } from "@/lib/store";
import { cancelStoreOrder, ensureStorePix, getOwnStoreOrder, reconcileStoreOrders, STORE_ORDER_COLUMNS, syncStoreOrder } from "@/lib/store-server";
import type {StoreFreightQuote} from "@/lib/store-freight";
import { STORE_PREVIEW_MESSAGE } from '@/lib/store-availability';

function invalidateStore() {
  revalidatePath("/painel", "layout");
  revalidatePath("/admin/fidelidade");
  revalidatePath("/admin/fidelidade/resgates");
  revalidatePath("/admin/fidelidade/recompensas");
}
function failed(error: unknown): ActionResult<never> {
  rethrowIfRedirect(error);
  if (error instanceof Error && error.message === "Preencha seu e-mail em Meus dados antes de pagar por Pix.") return { ok: false, error: error.message };
  // PostgREST devolve um objeto, não uma instância de Error. Nunca registrar payload,
  // credenciais, dados do comprador ou detalhes de linha retornados pelo PostgreSQL.
  const databaseError = error && typeof error === 'object' ? error as {code?:unknown;message?:unknown} : null;
  console.error("[store]", {
    code: typeof databaseError?.code === 'string' ? databaseError.code : undefined,
    message: typeof databaseError?.message === 'string' ? databaseError.message.slice(0,500) : 'Falha na loja',
  });
  return { ok: false, error: "Não foi possível concluir agora. Se o pedido foi criado, ele continua salvo abaixo para retomar sem cobrar novamente." };
}
const domainError = (message: string) => /^(Você já tem|A loja está|Saldo de Caracoins|Estoque insuficiente|Um produto|Modalidade|Preencha seu|O preço|Carrinho inválido|Produto duplicado|O carrinho deve|Voucher|Compra não|Separe compras|O frete)/.test(message);

export async function checkoutStoreAction(input: unknown): Promise<ActionResult<StoreOrder>> {
  try {
    const { customer } = await requireCustomer();
    if (!await storePurchasesEnabled(customer.id)) return {ok:false,error:STORE_PREVIEW_MESSAGE};
    const parsed = cartCheckoutSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Revise os produtos e quantidades do carrinho." };
    if (!await allow("store-checkout", customer.id)) return { ok: false, error: "Aguarde um pouco antes de tentar novamente." };
    const db = await createClient();
    const items=parsed.data.items.map((item,index)=>index===0?{...item,expected_freight_amount:parsed.data.expectedFreight??0}:item);
    const {data:id,error}=await isLocalStorePilot(customer.id)?await createAdminClient().rpc('run_local_store_pilot',{p_customer:customer.id,p_operation:'checkout',p_request_key:parsed.data.requestKey,p_items:items,p_voucher:parsed.data.voucherId??null}):await db.rpc("checkout_store_cart_cancellable", { p_request_key: parsed.data.requestKey, p_items: items, p_voucher: parsed.data.voucherId ?? null });
    if(error?.code==='42883' && error.message.includes('checkout_store_cart_live'))return {ok:false,error:'Atualização interna da loja pendente. Aplique a migration 0042 e tente novamente.'};
    if(error?.code==='PGRST202')return {ok:false,error:'Atualização da loja pendente. Aplique a migration 0061 e tente novamente.'};
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
    if (isStoreOrderOpen(order)) { if(order.cancellation_requested_at) await cancelStoreOrder(order); else {await ensureStorePix(order); await syncStoreOrder(await getOwnStoreOrder(id, customer.id) ?? order);} }
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
    if (!await allow("store-cancel", customer.id)) return { ok: false, error: "Aguarde um pouco antes de tentar novamente." };
    const order = await getOwnStoreOrder(id, customer.id);
    if (!order) return {ok:false,error:"Pedido não encontrado."};
    const result=await cancelStoreOrder(order);
    const updated=await getOwnStoreOrder(id,customer.id);
    if(!result.ok){
      invalidateStore();
      return {ok:false,error:["paid","payment_review","partially_refunded"].includes(result.reason??"") ? "Este pedido já recebeu um pagamento. O cancelamento do Pix não pode desfazer essa compra; fale com a equipe." : result.reason==="processing" ? "O banco está processando este Pix. O pedido de cancelamento ficou registrado; vamos conferir automaticamente. Não pague novamente." : "Seu pedido de cancelamento ficou registrado. Estamos aguardando a confirmação do Mercado Pago; estoque, voucher e frete serão liberados após o encerramento."};
    }
    if(!updated)throw new Error("Pedido não encontrado.");
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
    if(!await allow('store-catalog-write',profile.id))return {ok:false,error:'Aguarde um pouco antes de movimentar novamente.'};
    const note=String(form.get("note")??"").trim().slice(0,500);
    const declared=String(form.get('declared_value')??'').replace(',','.');
    if(status==='boxed' && declared && (!Number.isFinite(Number(declared))||Number(declared)<=0))return {ok:false,error:'Informe um valor declarado válido.'};
    const {error}=status==='boxed'?await db.rpc('box_store_order',{p_order_id:id,p_note:note,p_declared_value:declared?Number(declared):null}):await db.rpc('handle_store_order',{p_order_id:id,p_status:status,p_note:note});
    if (error) return { ok: false, error: /^(Informe o valor declarado|Confira o valor declarado|Pedido indisponível)/.test(error.message)?error.message:"Não foi possível movimentar. Confira se o pedido está pago e ainda não foi concluído." };
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

export async function getStoreFreightQuoteAction():Promise<ActionResult<StoreFreightQuote>>{
 try{const {customer}=await requireCustomer();if(!await allow('store-sync',customer.id))return {ok:false,error:'Aguarde alguns segundos para conferir o frete.'};
 const db=await createClient();const {data,error}=await db.rpc('get_store_freight_quote');if(error||!data)return {ok:false,error:'Não foi possível conferir o frete. Confira a migration 0041 e tente novamente.'};
 return {ok:true,data:data as StoreFreightQuote};
 }catch(error){rethrowIfRedirect(error);return {ok:false,error:'Não foi possível conferir o frete. Tente novamente.'};}
}
