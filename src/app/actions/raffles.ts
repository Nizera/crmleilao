"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { validateRafflePriceTiers } from "@/lib/raffle-pricing";
import { instantPrizeBatchSchema } from "@/lib/raffle-prize-input";
import { requireAdmin, requireCustomer } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { allow } from "@/lib/ratelimit";
import { rethrowIfRedirect, type ActionResult } from "@/lib/result";
import { raffleSchema, type RaffleOrder } from "@/lib/raffles";
import { ensureRafflePix, ownRaffleOrder, rafflesEnabled, syncRafflePayment, reconcileRafflePayments } from "@/lib/raffles-server";
import { cancelPixOrder, getOrder } from "@/lib/mercadopago";
import { createAdminClient } from "@/lib/supabase/admin";
import { isProductImageContent } from "@/lib/store-admin";

function invalidate() { revalidatePath("/rifas", "layout"); revalidatePath("/admin/rifa", "layout"); revalidatePath("/painel/rifas", "layout"); revalidatePath("/admin/relatorios"); }
export async function raffleCampaignLifecycle(id:string, action:"archive"|"restore"|"delete"):Promise<ActionResult>{
  try{
    await staff();
    if(!z.uuid().safeParse(id).success||!z.enum(["archive","restore","delete"]).safeParse(action).success)return {ok:false,error:"Ação inválida."};
    const {error}=await (await createClient()).rpc("raffle_campaign_lifecycle",{p_campaign:id,p_action:action});
    if(error)throw error;
    invalidate();return {ok:true,data:null};
  }catch(error){return failure(error);}
}
export async function boxRaffleAward(id: string, value: number): Promise<ActionResult> {
  try {
    await staff();
    if (!z.uuid().safeParse(id).success || !Number.isFinite(value) || value < 0 || value > 100000) return { ok: false, error: "Confira o valor declarado do prêmio ou deixe em branco." };
    const { error } = await (await createClient()).rpc("box_raffle_award", { p_issue: id, p_value: value });
    if (error) throw error;
    invalidate(); revalidatePath("/admin/envios"); return { ok: true, data: null };
  } catch (error) { return failure(error); }
}
function failure(error: unknown): ActionResult<never> {
  rethrowIfRedirect(error);
  const e = error as { code?: string; message?: string };
  if (e?.code === "P0001") return { ok: false, error: e.message || "Revise os dados." };
  return { ok: false, error: "Não foi possível concluir. Atualize a tela; reservas já criadas continuam em Minhas cotas. Confira também se a migration 0043 foi aplicada." };
}
async function staff() {
  const { profile } = await requireAdmin();
  if (profile.role === "viewer" || !await allow("store-catalog-write", profile.id)) throw new Error("Acesso limitado.");
  return profile;
}
export async function resolveRaffleReview(id: string): Promise<ActionResult> {
  try {
    const profile = await staff();
    if (!z.uuid().safeParse(id).success) return { ok: false, error: "Reserva inválida." };
    const db = createAdminClient();
    const { data: order, error } = await db.from("raffle_orders").select("id,status,mp_order_id,external_reference,amount").eq("id", id).single();
    if (error || !order || order.status !== "review" || !order.mp_order_id) return { ok: false, error: "Esta reserva não está disponível para conferência." };
    const payment = await getOrder(order.mp_order_id);
    if (!payment || payment.id !== order.mp_order_id || payment.externalReference !== order.external_reference || Math.round(payment.amount * 100) !== Math.round(Number(order.amount) * 100)) return { ok: false, error: "O pagamento consultado diverge da reserva." };
    if (payment.status !== "refunded" || payment.statusDetail === "partially_refunded") return { ok: false, error: "O Mercado Pago ainda não confirmou estorno integral. A reserva continua em análise." };
    const { error: resolutionError } = await db.rpc("resolve_refunded_raffle", { p_order: id, p_mp_id: payment.id, p_reference: payment.externalReference, p_amount: payment.amount, p_actor: profile.id });
    if (resolutionError) throw resolutionError;
    invalidate(); revalidatePath("/admin/envios"); return { ok: true, data: null };
  } catch (error) { return failure(error); }
}
export async function createRaffle(input: unknown): Promise<ActionResult<string>> {
  try {
    await staff();
    const data = raffleSchema.safeParse(input);
    if (!data.success) return { ok: false, error: data.error.issues[0].message };
    let tiers;
    try { tiers=validateRafflePriceTiers((input as {price_tiers?:unknown}).price_tiers??[],data.data.unit_price,data.data.max_quantity); } catch(error) { return {ok:false,error:(error as Error).message}; }
    const { data: id, error } = await (await createClient()).rpc("save_raffle_campaign_with_promotions", { p_data: data.data,p_tiers:tiers });
    if (error) throw error;
    invalidate(); return { ok: true, data: String(id) };
  } catch (error) { return failure(error); }
}

export async function saveRafflePromotions(id:string,tiers:unknown,expected:unknown):Promise<ActionResult> {
  try {
    await staff();
    if(!z.uuid().safeParse(id).success)return {ok:false,error:"Campanha inválida."};
    const db=await createClient();
    const {data:c,error:readError}=await db.from("raffle_campaigns").select("unit_price,max_quantity").eq("id",id).single();
    if(readError||!c)throw readError??new Error("Campanha indisponível.");
    let canonical;
    try {canonical=validateRafflePriceTiers(tiers,Number(c.unit_price),c.max_quantity);} catch(error){return {ok:false,error:(error as Error).message};}
    const {error}=await db.rpc("set_raffle_price_tiers",{p_campaign:id,p_tiers:canonical,p_expected:expected});
    if(error)throw error;
    invalidate();return {ok:true,data:null};
  }catch(error){return failure(error);}
}

export async function uploadRaffleImage(form: FormData): Promise<ActionResult<string>> {
  try {
    await staff(); const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > 1000000 || !isProductImageContent(new Uint8Array(await file.slice(0, 32).arrayBuffer()), file.type)) return { ok: false, error: "Use uma imagem JPG, PNG ou WebP de até 1 MB." };
    const admin = createAdminClient(); const ext = file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
    const path = `raffles/${crypto.randomUUID()}.${ext}`;
    const { error } = await admin.storage.from("lot-images").upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    return { ok: true, data: admin.storage.from("lot-images").getPublicUrl(path).data.publicUrl };
  } catch (error) { return failure(error); }
}
export async function saveRafflePhotos(id: string, urls: string[]): Promise<ActionResult> {
  try {
    await staff();
    const prefix = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/lot-images/`;
    const parsed = z.object({ id: z.uuid(), urls: z.array(z.url().max(2000).refine(url => url.startsWith(prefix))).max(6) }).safeParse({ id, urls });
    if (!parsed.success) return { ok: false, error: "Use até seis fotos enviadas pelo aplicativo." };
    const { error } = await (await createClient()).rpc("set_raffle_photos", { p_campaign: id, p_urls: [...new Set(parsed.data.urls)] });
    if (error) throw error;
    invalidate(); return { ok: true, data: null };
  } catch (error) { return failure(error); }
}
export async function manageRaffle(input: unknown): Promise<ActionResult> {
  try {
    await staff();
    const parsed = z.object({ campaign: z.uuid(), action: z.enum(["main", "instant", "open", "pause", "close"]), title: z.string().trim().max(160).optional(), quantity: z.number().int().min(1).max(100).default(1) }).safeParse(input);
    if (!parsed.success) return { ok: false, error: "Revise os dados da ação." };
    const p = parsed.data;
    const { error } = await (await createClient()).rpc("manage_raffle", { p_campaign: p.campaign, p_action: p.action, p_title: p.title ?? null, p_quantity: p.quantity });
    if (error) throw error;
    invalidate(); return { ok: true, data: null };
  } catch (error) { return failure(error); }
}
export async function recordRaffleWinner(input: unknown): Promise<ActionResult> {
  try {
    await staff();
    const p = z.object({ prize: z.uuid(), number: z.number().int().min(0).max(9999), note: z.string().trim().min(10).max(2000), evidence: z.url().max(2000).refine(v => v.startsWith("https://")).nullish() }).safeParse(input);
    if (!p.success) return { ok: false, error: "Informe a cota e os detalhes da apuração (mínimo de 10 caracteres)." };
    const { error } = await (await createClient()).rpc("record_raffle_winner", { p_prize: p.data.prize, p_number: p.data.number, p_note: p.data.note, p_evidence: p.data.evidence ?? null });
    if (error) throw error;
    invalidate(); return { ok: true, data: null };
  } catch (error) { return failure(error); }
}
export async function lookupRaffleBuyer(campaign: string, number: number): Promise<ActionResult<{ number: number; name: string } | null>> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role === "viewer") return { ok: false, error: "Seu perfil permite apenas consultar campanhas." };
    if (!z.uuid().safeParse(campaign).success || !Number.isInteger(number) || number < 0 || number > 9999) return { ok: false, error: "Informe uma cota válida." };
    if (!await allow("loyalty-read", profile.id)) return { ok: false, error: "Aguarde alguns segundos para consultar novamente." };
    const { data, error } = await (await createClient()).from("raffle_orders")
      .select("id,customer:customers(name)").eq("campaign_id", campaign).eq("status", "paid").contains("numbers", [number]).maybeSingle();
    if (error) throw error;
    if (!data) return { ok: true, data: null };
    const customer = data.customer as unknown as { name: string | null } | null;
    return { ok: true, data: { number, name: customer?.name || "Cliente cadastrado" } };
  } catch (error) { return failure(error); }
}
export async function reserveRaffle(input: unknown): Promise<ActionResult<RaffleOrder>> {
  try {
    const { customer } = await requireCustomer();
    if (!await rafflesEnabled()) return { ok: false, error: "As compras de cotas ainda não foram liberadas." };
    if (!await allow("store-checkout", customer.id)) return { ok: false, error: "Aguarde um pouco antes de reservar novamente." };
    const p = z.object({ campaign: z.uuid(), key: z.uuid(), numbers: z.array(z.number().int().min(0).max(9999)).min(1).max(1000).optional(), quantity: z.number().int().min(1).max(1000).optional(), expected_amount:z.number().positive().max(10000000).optional(), expected_unit_price:z.number().positive().max(10000).optional() }).safeParse(input);
    if (!p.success) return { ok: false, error: "Revise os números selecionados." };
    if((p.data.expected_amount===undefined)!==(p.data.expected_unit_price===undefined))return {ok:false,error:"Confira o preço e tente novamente."};
    const quoted=p.data.expected_amount!==undefined;
    const { data: id, error } = await (await createClient()).rpc(quoted?"reserve_raffle_at_price":"reserve_raffle", { p_campaign: p.data.campaign, p_key: p.data.key, p_numbers: p.data.numbers ?? null, p_quantity: p.data.quantity ?? null,...(quoted?{p_expected_amount:p.data.expected_amount,p_expected_unit_price:p.data.expected_unit_price}:{}) });
    if (error) throw error;
    const order = await ownRaffleOrder(String(id), customer.id);
    if (!order) throw new Error("Pedido não encontrado.");
    // A reserva é durável mesmo se o provedor estiver indisponível.
    try { await ensureRafflePix(order); } catch { /* retomada idempotente em Minhas cotas */ }
    invalidate(); return { ok: true, data: (await ownRaffleOrder(order.id, customer.id)) ?? order };
  } catch (error) { return failure(error); }
}
export async function refreshRaffleOrder(id: string, cancel = false): Promise<ActionResult<RaffleOrder>> {
  try {
    const { customer } = await requireCustomer();
    if (!z.uuid().safeParse(id).success || !await allow("raffle-order", customer.id)) return { ok: false, error: "Aguarde alguns segundos para consultar novamente." };
    let order = await ownRaffleOrder(id, customer.id);
    if (!order) return { ok: false, error: "Reserva não encontrada." };
    if (["creating", "pending"].includes(order.status)) {
      await ensureRafflePix(order);
      order = (await ownRaffleOrder(id, customer.id))!;
      await syncRafflePayment(order);
      if (cancel && order.mp_order_id) {
        const latest = await ownRaffleOrder(id, customer.id);
        if (latest && ["creating", "pending"].includes(latest.status)) { await cancelPixOrder(order.mp_order_id); await syncRafflePayment(order); }
      }
    }
    const updated = await ownRaffleOrder(id, customer.id);
    if (!updated) throw new Error("Reserva indisponível.");
    if (updated.status !== order.status) invalidate();
    return { ok: true, data: updated };
  } catch (error) { return failure(error); }
}

export async function setRafflePurchases(enabled: boolean): Promise<ActionResult> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role !== "owner" || typeof enabled !== "boolean") return { ok: false, error: "Apenas o dono pode liberar as compras." };
    const { error } = await (await createClient()).rpc("set_raffle_purchases", { p_enabled: enabled });
    if (error) throw error;
    invalidate(); return { ok: true, data: null };
  } catch (error) { return failure(error); }
}

export async function reconcileRaffles(): Promise<ActionResult<{ checked: number; failed: number }>> {
  try { await staff(); const result = await reconcileRafflePayments(); invalidate(); return { ok: true, data: result }; }
  catch (error) { return failure(error); }
}

/** Uma consulta por página; no máximo três consultas ao provedor por rodada. */
export async function refreshRaffleOrders(ids: string[], offset: number): Promise<ActionResult<RaffleOrder[]>> {
  try {
    const { customer } = await requireCustomer();
    const parsed = z.object({ ids: z.array(z.uuid()).min(1).max(10), offset: z.number().int().min(0).max(9) }).safeParse({ ids, offset });
    if (!parsed.success) return { ok: false, error: "Lista de reservas inválida." };
    if (!await allow("raffle-sync", customer.id)) return { ok: false, error: "Aguarde alguns segundos para consultar novamente." };
    const db = await createClient();
    const own = await db.from("raffle_orders").select("*").eq("customer_id", customer.id).in("id", [...new Set(ids)]).order("created_at").order("id");
    if (own.error) throw own.error;
    const active = (own.data as RaffleOrder[]).filter(o => ["creating", "pending"].includes(o.status));
    const ordered = active.slice(offset).concat(active.slice(0, offset));
    await Promise.all(ordered.slice(0, 3).map(async order => {
      try {
        const signal = AbortSignal.timeout(12000);
        await ensureRafflePix(order, signal);
        const latest = await ownRaffleOrder(order.id, customer.id);
        if (latest) await syncRafflePayment(latest, signal);
      } catch { /* A reserva persiste e será tentada novamente; não libera recursos. */ }
    }));
    const latest = await db.from("raffle_orders").select("*").eq("customer_id", customer.id).in("id", [...new Set(ids)]);
    if (latest.error) throw latest.error;
    return { ok: true, data: latest.data as RaffleOrder[] };
  } catch (error) { return failure(error); }
}

export async function addRaffleInstantPrizes(input: unknown): Promise<ActionResult> {
  try {
    await staff();
    const prefix = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/lot-images/raffles/`;
    const parsed = instantPrizeBatchSchema(prefix).safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    const { error } = await (await createClient()).rpc("add_raffle_instant_prizes", {
      p_campaign: parsed.data.campaign, p_key: parsed.data.key, p_items: parsed.data.items,
    });
    if (error) {
      if (error.code === "PGRST202") return { ok: false, error: "Aplique a migration 0064 para habilitar o cadastro de cotas com fotos." };
      throw error;
    }
    invalidate(); return { ok: true, data: null };
  } catch (error) { return failure(error); }
}

export async function saveRafflePrizePhotos(id: string, urls: string[]): Promise<ActionResult> {
  try {
    await staff();
    const prefix = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/lot-images/raffles/`;
    const parsed = z.object({ id: z.uuid(), urls: z.array(z.url().max(2000).refine(url => url.startsWith(prefix))).max(4) }).safeParse({ id, urls });
    if (!parsed.success) return { ok: false, error: "Use até quatro fotos enviadas pelo app." };
    const { error } = await (await createClient()).rpc("set_raffle_prize_photos", { p_prize: id, p_urls: [...new Set(urls)] });
    if (error) throw error;
    invalidate(); return { ok: true, data: null };
  } catch (error) { return failure(error); }
}

export async function editRaffleInstantPrize(input: unknown): Promise<ActionResult> {
  try {
    await staff();
    const parsed = z.object({ id:z.uuid(), action:z.enum(["edit","delete"]), title:z.string().trim().max(160), expectedTitle:z.string().max(160) }).safeParse(input);
    if (!parsed.success || parsed.data.action === "edit" && !parsed.data.title) return {ok:false,error:"Informe o nome do prêmio."};
    const p=parsed.data;
    const {error}=await(await createClient()).rpc("edit_raffle_instant_prize",{p_prize:p.id,p_action:p.action,p_title:p.title,p_expected_title:p.expectedTitle});
    if(error?.code==="PGRST202")return {ok:false,error:"Aplique a migration 0067 para editar e excluir cotas premiadas."};
    if(error)throw error;
    invalidate();return {ok:true,data:null};
  }catch(error){return failure(error);}
}
