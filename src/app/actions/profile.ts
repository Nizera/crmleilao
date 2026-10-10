"use server";

import { revalidatePath } from "next/cache";
import { requireCustomer } from "@/lib/dal";
import { shippingFormSchema } from "@/lib/customers";
import type { ActionResult } from "@/lib/result";
import { createClient } from "@/lib/supabase/server";

const failure = (error: string): ActionResult<never> => ({ ok: false, error });

/**
 * Endereço para envio — o próprio cliente grava (RLS self-update).
 * Usado no primeiro login (obrigatório) e em "Meus dados".
 */
export async function saveShippingData(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { customer } = await requireCustomer();

    const parsed = shippingFormSchema.safeParse({
      name: formData.get("name") ?? "",
      email: formData.get("email") ?? "",
      cpf_cnpj: formData.get("cpf_cnpj") ?? "",
      address_cep: formData.get("address_cep") ?? "",
      address_street: formData.get("address_street") ?? "",
      address_number: formData.get("address_number") ?? "",
      address_complement: formData.get("address_complement") ?? "",
      address_district: formData.get("address_district") ?? "",
      address_city: formData.get("address_city") ?? "",
      address_state: formData.get("address_state") ?? "",
    });

    if (!parsed.success) {
      return failure(parsed.error.issues[0]?.message ?? "Dados inválidos.");
    }

    const patch = {
      name: parsed.data.name,
      email: parsed.data.email.toLowerCase(),
      cpf_cnpj: parsed.data.cpf_cnpj.replace(/\D/g, ""),
      address_cep: parsed.data.address_cep.replace(/\D/g, ""),
      address_street: parsed.data.address_street,
      address_number: parsed.data.address_number,
      address_complement: parsed.data.address_complement || null,
      address_district: parsed.data.address_district,
      address_city: parsed.data.address_city,
      address_state: parsed.data.address_state.toUpperCase(),
    };

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("customers")
      .update(patch)
      .eq("id", customer.id)
      .select("id")
      .maybeSingle();

    if (error) {
      const missingColumn =
        error.message.includes("address_") &&
        (error.message.includes("does not exist") ||
          error.message.includes("not found in the schema cache") ||
          error.message.includes("Could not find"));
      if (missingColumn) {
        return failure(
          "Cadastro de endereço indisponível: aplique a migração 0004_settings.sql no SQL Editor.",
        );
      }
      return failure(`Falha ao salvar endereço: ${error.message}`);
    }
    if (!data) return failure("Não foi possível salvar os dados.");

    revalidatePath("/painel/cadastro");
    revalidatePath("/painel");
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Erro inesperado.");
  }
}
