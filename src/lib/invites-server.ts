import "server-only";

import { generateInviteToken, hashInviteToken, inviteUrl } from "@/lib/invites";
import { siteUrl } from "@/lib/lots";
import { createAdminClient } from "@/lib/supabase/admin";

export type InviteResult =
  | { ok: true; url: string; expiresAt: string }
  | { ok: false; error: string };

/**
 * Cria (ou substitui) o convite de acesso do cliente e devolve a URL.
 *
 * Usado pela action "Gerar convite" da ficha do cliente e automaticamente
 * quando o lote cria um cliente novo. Só funciona com service role — a
 * tabela customer_invites tem RLS fechada de propósito.
 */
export async function createInviteForCustomer(
  customerId: string,
  createdBy?: string,
): Promise<InviteResult> {
  const admin = createAdminClient();

  const { data: customer, error: customerError } = await admin
    .from("customers")
    .select("id")
    .eq("id", customerId)
    .maybeSingle();

  if (customerError) {
    return {
      ok: false,
      error: `Falha ao consultar o cliente: ${customerError.message}`,
    };
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
    return {
      ok: false,
      error: `Falha ao revogar convites antigos: ${revokeError.message}`,
    };
  }

  const token = generateInviteToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { error: insertError } = await admin.from("customer_invites").insert({
    customer_id: customerId,
    token,
    token_hash: hashInviteToken(token),
    created_by: createdBy ?? null,
    expires_at: expiresAt,
  });

  if (insertError) {
    if (insertError.message.includes("customer_invites")) {
      return {
        ok: false,
        error:
          "Convites indisponíveis: aplique a migração 0007_customer_invites.sql no SQL Editor.",
      };
    }
    return { ok: false, error: `Falha ao gerar o convite: ${insertError.message}` };
  }

  return { ok: true, url: inviteUrl(token, siteUrl()), expiresAt };
}

/**
 * Devolve o convite pendente do cliente ou cria um — sem invalidar um link
 * que já tenha sido mandado. Usado pelo botão "Enviar convite" dos lotes.
 */
export async function getOrCreateInviteForCustomer(
  customerId: string,
  createdBy?: string,
): Promise<InviteResult> {
  const admin = createAdminClient();

  const { data: pending, error: pendingError } = await admin
    .from("customer_invites")
    .select("token, expires_at")
    .eq("customer_id", customerId)
    .is("used_at", null)
    .gte("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingError && pendingError.message.includes("customer_invites")) {
    return {
      ok: false,
      error:
        "Convites indisponíveis: aplique a migração 0007_customer_invites.sql no SQL Editor.",
    };
  }

  if (pending?.token) {
    return {
      ok: true,
      url: inviteUrl(pending.token, siteUrl()),
      expiresAt: pending.expires_at,
    };
  }

  return createInviteForCustomer(customerId, createdBy);
}
