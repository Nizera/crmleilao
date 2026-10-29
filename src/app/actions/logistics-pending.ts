"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/dal";
import { isIsoDay } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { rethrowIfRedirect, type ActionResult } from "@/lib/result";

const schema = z.object({
  customer_id: z.uuid(),
  title: z.string().trim().min(1, "Informe os itens da pendência.").max(160),
  quantity: z.coerce.number().int().min(1).max(999),
  reason: z.string().trim().min(1, "Informe o motivo da reposição.").max(2000),
  shipping_date: z.string().refine(isIsoDay, "Informe uma data válida."),
});

function refresh() {
  for (const path of ["/admin/pendencias", "/admin/relatorios", "/admin/envios"]) revalidatePath(path);
}

export async function createLogisticsPendingAction(form: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role === "viewer") return { ok: false, error: "Seu perfil é somente leitura." };
    const parsed = schema.safeParse(Object.fromEntries(form.entries()));
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Confira os dados." };
    const value = parsed.data;
    const db = await createClient();
    const { data, error } = await db.rpc("create_logistics_pending", {
      p_customer: value.customer_id, p_title: value.title, p_quantity: value.quantity,
      p_reason: value.reason, p_day: value.shipping_date,
    });
    if (error) return { ok: false, error: "Não foi possível registrar a pendência. Confira os dados e se a migration 0035 foi aplicada." };
    refresh();
    return { ok: true, data: { id: String(data) } };
  } catch (error) {
    rethrowIfRedirect(error);
    return { ok: false, error: "Não foi possível registrar a pendência." };
  }
}

export async function handleLogisticsPendingAction(id: string, action: string, day?: string): Promise<ActionResult<null>> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role === "viewer") return { ok: false, error: "Seu perfil é somente leitura." };
    if (!z.uuid().safeParse(id).success || !["box", "reopen", "cancel", "reschedule"].includes(action) || (action === "reschedule" && !isIsoDay(day))) {
      return { ok: false, error: "Dados da ação inválidos." };
    }
    const db = await createClient();
    const { error } = await db.rpc("handle_logistics_pending", { p_id: id, p_action: action, p_day: action === "reschedule" ? day : null });
    if (error) return { ok: false, error: error.message };
    refresh();
    return { ok: true, data: null };
  } catch (error) {
    rethrowIfRedirect(error);
    return { ok: false, error: "Não foi possível atualizar a pendência." };
  }
}
