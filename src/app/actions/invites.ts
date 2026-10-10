"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/dal";
import { generateInviteToken, hashInviteToken } from "@/lib/invites";
import { siteUrl } from "@/lib/lots";
import type { ActionResult } from "@/lib/result";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Gera um novo link de convite de acesso ao painel para o cliente.
 * Substitui qualquer convite anterior não usado; o link vale por 7 dias
 * e pode ser usado uma única vez.
 */
export async function createCustomerInvite(
  customerId: string,
): Promise<ActionResult<{ url: string }>> {
  try {
    const { user } = await requireAdmin();

    const admin = createAdminClient();

    const { data: customer, error: customerError } = await admin
      .from("customers")
      .select("id")
      .eq("id", customerId)
      .maybeSingle();

    if (customerError) {
      return { ok: false, error: `Falha ao consultar o cliente: ${customerError.message}` };
    }
    if (!customer) return { ok: false, error: "Cliente não encontrado." };

    // Um convite ativo por cliente: descarta os anteriores não usados.
    const { error: revokeError } = await admin
      .from("customer_invites")
      .delete()
      .eq("customer_id", customerId)
      .is("used_at", null);

    if (revokeError) {
      if (revokeError.message.includes("customer_invites")) {
        return {
          ok: false,
          error:
            "Convites indisponíveis: aplique a migração 0007_customer_invites.sql no SQL Editor.",
        };
      }
      return { ok: false, error: `Falha ao revogar convites antigos: ${revokeError.message}` };
    }

    const token = generateInviteToken();
    const { error: insertError } = await admin.from("customer_invites").insert({
      customer_id: customerId,
      token_hash: hashInviteToken(token),
      created_by: user.id,
    });

    if (insertError) {
      return { ok: false, error: `Falha ao gerar o convite: ${insertError.message}` };
    }

    revalidatePath(`/admin/clientes/${customerId}`);

    return {
      ok: true,
      data: { url: `${siteUrl()}/painel/convite?token=${token}` },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Erro inesperado.",
    };
  }
}
