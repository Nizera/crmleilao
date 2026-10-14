"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/dal";
import {
  createInviteForCustomer,
  getOrCreateInviteForCustomer,
} from "@/lib/invites-server";
import { rethrowIfRedirect, type ActionResult } from "@/lib/result";

/**
 * Gera um novo link de convite de acesso ao painel para o cliente.
 * Substitui qualquer convite anterior não usado; o link vale por 7 dias
 * e pode ser usado uma única vez.
 */
export async function createCustomerInvite(
  customerId: string,
): Promise<ActionResult<{ url: string }>> {
  try {
    const { user, profile } = await requireAdmin();
    if (profile.role === "viewer") {
      return { ok: false, error: "Seu perfil é somente leitura." };
    }

    const result = await createInviteForCustomer(customerId, user.id);
    if (!result.ok) return { ok: false, error: result.error };

    revalidatePath(`/admin/clientes/${customerId}`);
    return { ok: true, data: { url: result.url } };
  } catch (error) {
    rethrowIfRedirect(error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Erro inesperado.",
    };
  }
}

/**
 * Link de convite para mandar no WhatsApp pelo botão da lista de lotes.
 * Reaproveita o pendente — não invalida um link já enviado.
 */
export async function inviteLinkForCustomer(
  customerId: string,
): Promise<ActionResult<{ url: string }>> {
  try {
    const { user, profile } = await requireAdmin();
    if (profile.role === "viewer") {
      return { ok: false, error: "Seu perfil é somente leitura." };
    }

    const result = await getOrCreateInviteForCustomer(customerId, user.id);
    if (!result.ok) return { ok: false, error: result.error };

    revalidatePath(`/admin/clientes/${customerId}`);
    return { ok: true, data: { url: result.url } };
  } catch (error) {
    rethrowIfRedirect(error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Erro inesperado.",
    };
  }
}
