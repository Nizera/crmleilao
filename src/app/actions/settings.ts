"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { settingsFormSchema } from "@/lib/settings";
import type { ActionResult } from "@/lib/result";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const failure = (error: string): ActionResult<never> => ({ ok: false, error });

const migrationHint =
  "Aplique a migração 0004_settings.sql no SQL Editor do Supabase e tente de novo.";

/** Erro de tabela ausente vira aviso amigável (migração pendente). */
function friendly(error: { message: string; code?: string }): string {
  const missing =
    error.code === "42P01" ||
    error.message.includes("does not exist") ||
    error.message.includes("Could not find the table") ||
    error.message.includes("not found in the schema cache");
  if (missing) return migrationHint;
  return `Falha ao salvar configuração: ${error.message}`;
}

/**
 * Salva parâmetros do leilão e modelos de mensagem.
 * Só o dono: o guard é reforçado pelo RLS (update só para is_owner()).
 */
export async function saveAppSettings(
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role !== "owner") {
      return failure("Apenas o dono altera a configuração.");
    }

    const parsed = settingsFormSchema.safeParse(
      Object.fromEntries(formData.entries()),
    );
    if (!parsed.success) {
      return failure(parsed.error.issues[0]?.message ?? "Dados inválidos.");
    }

    const basePatch = {
      bid_increment: Number(parsed.data.bid_increment.replace(",", ".")),
      shipping_weekday: Number(parsed.data.shipping_weekday),
      wa_notice_template: parsed.data.wa_notice_template,
      wa_payment_template: parsed.data.wa_payment_template,
      wa_shipping_template: parsed.data.wa_shipping_template,
      updated_by: profile.id,
    };
    const originPatch = {
      origin_name: parsed.data.origin_name || null,
      origin_address: parsed.data.origin_address || null,
      origin_number: parsed.data.origin_number || null,
      origin_district: parsed.data.origin_district || null,
      origin_city: parsed.data.origin_city || null,
      origin_state: parsed.data.origin_state || null,
      origin_cep: parsed.data.origin_cep || null,
    };

    const supabase = await createClient();
    let { data, error } = await supabase
      .from("app_settings")
      .update({ ...basePatch, ...originPatch })
      .eq("id", true)
      .select("id");

    // Migração 0006 (colunas de origem) ainda não aplicada: salva só o resto.
    if (error && /origin_|does not exist|schema cache/i.test(error.message)) {
      ({ data, error } = await supabase
        .from("app_settings")
        .update(basePatch)
        .eq("id", true)
        .select("id"));
    }

    if (error) return failure(friendly(error));

    // Linha sumiu (seed perdido): recria com service role.
    if (!data?.length) {
      const admin = createAdminClient();
      const { error: upsertError } = await admin
        .from("app_settings")
        .upsert({ id: true, ...basePatch, ...originPatch });
      if (upsertError && /origin_/i.test(upsertError.message)) {
        const retry = await admin
          .from("app_settings")
          .upsert({ id: true, ...basePatch });
        if (retry.error) return failure(friendly(retry.error));
      } else if (upsertError) {
        return failure(friendly(upsertError));
      }
    }

    revalidatePath("/admin/configuracao");
    revalidatePath("/admin/lotes");
    return { ok: true, data: null };
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Erro inesperado.");
  }
}
