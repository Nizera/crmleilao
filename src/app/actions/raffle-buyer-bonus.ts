"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { rethrowIfRedirect, type ActionResult } from "@/lib/result";

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), campaign: z.uuid(), title: z.string().trim().min(3).max(120), kind: z.enum(["physical", "pix", "voucher"]), amount: z.number().positive().max(100000).nullable(), version: z.number().int().min(0) }),
  z.object({ action: z.literal("fulfill"), campaign: z.uuid(), note: z.string().trim().min(10).max(500) }),
  z.object({ action: z.literal("historical"), campaign: z.uuid(), alreadyFulfilled: z.boolean(), note: z.string().trim().min(10).max(500) }),
]);

export async function manageBuyerBonus(input: unknown): Promise<ActionResult> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role === "viewer") return { ok: false, error: "Seu perfil permite apenas consulta." };
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Confira o prêmio, o valor e a observação (mínimo de 10 caracteres)." };
    const p = parsed.data;
    if (p.action === "historical" && profile.role !== "owner") return { ok: false, error: "Apenas o dono pode conferir entregas anteriores." };
    const db = await createClient();
    const result = p.action === "save"
      ? await db.rpc("set_raffle_buyer_bonus", { p_campaign: p.campaign, p_title: p.title, p_kind: p.kind, p_amount: p.amount, p_expected: p.version })
      : p.action === "fulfill"
        ? await db.rpc("fulfill_raffle_buyer_bonus", { p_campaign: p.campaign, p_note: p.note })
        : await db.rpc("confirm_historical_buyer_bonus", { p_campaign: p.campaign, p_already_fulfilled: p.alreadyFulfilled, p_note: p.note });
    if (result.error) return { ok: false, error: result.error.code === "P0001" ? result.error.message : "Não foi possível atualizar o bônus. Confira se a atualização do banco foi aplicada." };
    revalidatePath("/admin/rifa", "layout");
    revalidatePath("/painel/rifas", "layout");
    revalidatePath("/rifas", "layout");
    revalidatePath("/admin/relatorios");
    return { ok: true, data: null };
  } catch (error) {
    rethrowIfRedirect(error);
    return { ok: false, error: "Não foi possível atualizar o bônus. Atualize a página e tente novamente." };
  }
}
