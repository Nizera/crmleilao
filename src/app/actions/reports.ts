"use server";

import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  getSeparationReport,
  type SeparationReport,
} from "@/lib/reports-server";
import { rethrowIfRedirect, type ActionResult } from "@/lib/result";

const failure = (error: string): ActionResult<never> => ({ ok: false, error });

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function moveReportItemsToBoxesAction(input: unknown): Promise<ActionResult<{ moved: number }>> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role === "viewer") return failure("Seu perfil é somente leitura.");
    const ids = z.array(z.uuid()).max(100).refine(values => values.length === new Set(values).size);
    const parsed = z.object({ lotIds: ids, issueIds: ids }).refine(value => value.lotIds.length + value.issueIds.length >= 1 && value.lotIds.length + value.issueIds.length <= 100).safeParse(input);
    if (!parsed.success) return failure("Selecione de 1 a 100 itens diferentes para movimentar.");
    const { data, error } = await (await createClient()).rpc("move_report_items_to_boxes", { p_lot_ids: parsed.data.lotIds, p_issue_ids: parsed.data.issueIds });
    if (error?.code === "PGRST202") return failure("A movimentação de prêmios em lote precisa da atualização 0089 no banco.");
    if (error) return failure(error.code === "P0001" ? error.message : "Não foi possível movimentar a seleção. Nenhum item foi alterado.");
    for (const path of ["/admin/relatorios", "/admin/estoque", "/admin/lotes", "/admin/pendencias", "/admin/rifa/premios", "/admin/envios", "/painel"]) revalidatePath(path, "layout");
    return { ok: true, data: { moved: Number(data.moved) } };
  } catch (error) { rethrowIfRedirect(error); return failure("Não foi possível movimentar a seleção."); }
}

/** Recarrega o relatório de separação quando a data muda na tela. */
export async function getSeparationReportAction(
  shippingDate: string,
): Promise<ActionResult<SeparationReport>> {
  try {
    await requireAdmin();
    if (shippingDate !== "all" && !ISO_DATE.test(shippingDate)) return failure("Data inválida.");
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
