"use server";

import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
  getSeparationReport,
  type SeparationReport,
} from "@/lib/reports-server";
import { rethrowIfRedirect, type ActionResult } from "@/lib/result";

const failure = (error: string): ActionResult<never> => ({ ok: false, error });

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Recarrega o relatório de separação quando a data muda na tela. */
export async function getSeparationReportAction(
  shippingDate: string,
): Promise<ActionResult<SeparationReport>> {
  try {
    await requireAdmin();
    if (!ISO_DATE.test(shippingDate)) return failure("Data inválida.");
    return { ok: true, data: await getSeparationReport(shippingDate) };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(
      error instanceof Error ? error.message : "Falha ao gerar o relatório.",
    );
  }
}

/** Registra a separação física selecionada e debita o estoque atomicamente. */
export async function moveLotsToCustomerBoxesAction(
  rawIds: unknown,
): Promise<ActionResult<{ moved: number }>> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role === "viewer") return failure("Seu perfil é somente leitura.");
    if (!Array.isArray(rawIds) || rawIds.length < 1 || rawIds.length > 100 ||
      rawIds.some((id) => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
      return failure("Selecione de 1 a 100 lotes válidos.");
    }
    const ids = rawIds as string[];
    if (new Set(ids).size !== ids.length) return failure("A seleção contém lotes duplicados.");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("move_lots_to_customer_boxes", {
      p_lot_ids: ids,
    });
    if (error) return failure(`Falha ao movimentar lotes: ${error.message}`);
    revalidatePath("/admin/relatorios");
    revalidatePath("/admin/estoque");
    revalidatePath("/admin/lotes");
    return { ok: true, data: { moved: Number(data) } };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(error instanceof Error ? error.message : "Falha ao movimentar lotes.");
  }
}
