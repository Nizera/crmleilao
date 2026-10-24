"use server";

import { revalidatePath } from "next/cache";

import { requireCustomer } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { rethrowIfRedirect, type ActionResult } from "@/lib/result";

function selfError(scope: string, error: unknown): string {
  console.error(
    `[notifications] ${scope}:`,
    error instanceof Error ? error.message : error,
  );
  return "Não foi possível concluir agora. Tente novamente em instantes.";
}

/** Marca uma notificação como lida (RLS garante que é do próprio cliente). */
export async function markNotificationReadAction(
  id: string,
): Promise<ActionResult<null>> {
  try {
    const { customer } = await requireCustomer();
    const supabase = await createClient();

    const { error } = await supabase
      .from("customer_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id)
      .eq("customer_id", customer.id)
      .is("read_at", null);

    if (error) throw new Error(error.message);
    revalidatePath("/painel");
    return { ok: true, data: null };
  } catch (error) {
    rethrowIfRedirect(error);
    return { ok: false, error: selfError("marcar lida", error) };
  }
}

/** Marca todas as notificações do cliente como lidas. */
export async function markAllNotificationsReadAction(): Promise<ActionResult<null>> {
  try {
    const { customer } = await requireCustomer();
    const supabase = await createClient();

    const { error } = await supabase
      .from("customer_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("customer_id", customer.id)
      .is("read_at", null);

    if (error) throw new Error(error.message);
    revalidatePath("/painel");
    return { ok: true, data: null };
  } catch (error) {
    rethrowIfRedirect(error);
    return { ok: false, error: selfError("marcar todas", error) };
  }
}
