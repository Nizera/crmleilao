"use server";

import { requireAdmin } from "@/lib/dal";
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
