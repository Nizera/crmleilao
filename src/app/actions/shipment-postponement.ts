"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { rethrowIfRedirect, type ActionResult } from "@/lib/result";

export async function postponeCustomerShipping(input: {
  customerId: string; from: string; to: string; includeLogistics: boolean;
}): Promise<ActionResult<{ lots: number; logistics: number }>> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role === "viewer") return { ok: false, error: "Seu perfil é somente leitura." };
    const parsed = z.object({ customerId: z.uuid(), from: z.iso.date(), to: z.iso.date(), includeLogistics: z.boolean() }).safeParse(input);
    if (!parsed.success || input.to <= input.from) return { ok: false, error: "Confira a nova data de envio." };
    const { data, error } = await (await createClient()).rpc("postpone_customer_shipping", {
      p_customer: input.customerId, p_from: input.from, p_to: input.to, p_logistics: input.includeLogistics,
    });
    if (error) return { ok: false, error: error.code === "P0001" ? error.message : "Não foi possível adiar. Confira se a atualização 0084 foi aplicada." };
    updateTag("dashboard");
    for (const path of ["/admin/envios", "/admin/lotes", "/admin/relatorios", "/admin/pendencias", "/admin/rifa/premios", "/painel"]) revalidatePath(path);
    return { ok: true, data: data as { lots: number; logistics: number } };
  } catch (error) {
    rethrowIfRedirect(error);
    return { ok: false, error: "Não foi possível adiar o envio. Atualize a tela e tente novamente." };
  }
}
