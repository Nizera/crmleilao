"use server";

import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/dal";
import { rethrowIfRedirect, type ActionResult } from "@/lib/result";
import { createClient } from "@/lib/supabase/server";

const failure = (error: string): ActionResult<never> => ({ ok: false, error });

const adjustSchema = z.object({
  stock_item_id: z.string().trim().min(1, "Item inválido"),
  qty: z
    .string()
    .trim()
    .regex(/^-?\d{1,4}$/, "Quantidade inválida (use um número inteiro)"),
  note: z.string().trim().max(500).optional(),
});

/**
 * Ajuste manual de saldo: entrada de mercadoria, correção ou contagem.
 * Delta positivo soma, negativo subtrai. Sempre grava no ledger.
 */
export async function adjustStock(
  formData: FormData,
): Promise<ActionResult<{ qty_on_hand: number }>> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role === "viewer") {
      return failure("Seu perfil é somente leitura.");
    }

    const parsed = adjustSchema.safeParse({
      stock_item_id: formData.get("stock_item_id"),
      qty: formData.get("qty"),
      note: formData.get("note") ?? "",
    });

    if (!parsed.success) {
      return failure(parsed.error.issues[0]?.message ?? "Dados inválidos.");
    }

    const delta = Number(parsed.data.qty);
    if (delta === 0) return failure("Quantidade não pode ser zero.");

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("adjust_stock", {
      p_item_id: parsed.data.stock_item_id,
      p_qty: delta,
      p_note: parsed.data.note ?? null,
    });

    if (error) return failure(`Falha ao ajustar estoque: ${error.message}`);

    updateTag("dashboard");
    revalidatePath("/admin/estoque");
    revalidatePath("/admin/lotes");

    return { ok: true, data: { qty_on_hand: Number(data) } };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(error instanceof Error ? error.message : "Erro inesperado.");
  }
}
