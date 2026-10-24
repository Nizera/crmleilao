import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Grava uma notificação no sino do cliente (service role, sem RLS).
 *
 * Fire-and-forget: falha aqui NUNCA pode derrubar o fluxo que chamou
 * (webhook de pagamento, transição de envio) — só loga.
 *
 * `dedupeKey` é obrigatório: o webhook do MP/SuperFrete reenvia eventos e o
 * índice unique (customer_id, dedupe_key) segura a duplicação.
 */
export async function notifyCustomer(input: {
  customerId: string;
  kind: string;
  title: string;
  body?: string;
  href?: string | null;
  dedupeKey: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("customer_notifications").upsert(
      {
        customer_id: input.customerId,
        kind: input.kind,
        title: input.title,
        body: input.body ?? "",
        href: input.href ?? null,
        dedupe_key: input.dedupeKey,
      },
      { onConflict: "customer_id,dedupe_key", ignoreDuplicates: true },
    );
    if (error) console.error("[notifications] gravar:", error.message);
  } catch (error) {
    console.error(
      "[notifications] gravar:",
      error instanceof Error ? error.message : error,
    );
  }
}
