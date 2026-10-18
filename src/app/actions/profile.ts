"use server";

import { revalidatePath } from "next/cache";
import { requireCustomer } from "@/lib/dal";
import { shippingFormSchema } from "@/lib/customers";
import { allow } from "@/lib/ratelimit";
import { rethrowIfRedirect, type ActionResult } from "@/lib/result";
import { createClient } from "@/lib/supabase/server";

const failure = (error: string): ActionResult<never> => ({ ok: false, error });

const RATE_MSG = "Muitas tentativas. Aguarde alguns minutos e tente de novo.";

/**
 * Migração pendente no servidor: o detalhe (nome do arquivo) fica no log —
 * em produção o cliente não precisa saber o nome do SQL que falta.
 */
function migrationMissing(file: string): string {
  console.error(`[profile] migração não aplicada: ${file}`);
  return "Recurso indisponível no momento. Avise o leilão para atualizar o cadastro.";
}

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
      // Migração 0004 ausente: detalhe no log do servidor, não no toast.
      if (missingColumn) return failure(migrationMissing("0004_settings.sql"));
      console.error(`[profile] salvar endereço: ${error.message}`);
      return failure("Não foi possível salvar seus dados. Tente novamente.");
    }
    if (!data) return failure("Não foi possível salvar os dados.");

    revalidatePath("/painel/cadastro");
    revalidatePath("/painel");
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    rethrowIfRedirect(error);
    console.error("[profile] salvar endereço:", error);
    return failure("Erro inesperado. Tente novamente.");
  }
}

/**
 * Troca de senha pelo próprio cliente.
 *
 * O Supabase não confere a senha atual em `updateUser`, então a volta é
 * confirmada com um `signInWithPassword` antes de gravar a nova. O rate limit
 * é por conta: é isso que segura quem tentaria chutar a senha atual.
 */
export async function changeOwnPasswordAction(
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const current = String(formData.get("current") ?? "");
    const next = String(formData.get("next") ?? "");
    const confirm = String(formData.get("confirm") ?? "");

    if (!current) return failure("Informe sua senha atual.");
    if (next.length < 8) return failure("A nova senha precisa de pelo menos 8 caracteres.");
    if (next === current) return failure("A nova senha precisa ser diferente da atual.");
    if (next !== confirm) return failure("As senhas não conferem.");

    const { customer } = await requireCustomer();
    if (!(await allow("customer-password", customer.phone_e164))) {
      return failure(RATE_MSG);
    }

    const supabase = await createClient();

    const { error: verifyError } = await supabase.auth.signInWithPassword({
      phone: customer.phone_e164,
      password: current,
    });
    if (verifyError) {
      console.error(`[profile] senha atual incorreta: ${verifyError.message}`);
      return failure("Senha atual incorreta.");
    }

    const { error } = await supabase.auth.updateUser({ password: next });
    if (error) {
      console.error(`[profile] trocar senha: ${error.message}`);
      if (error.message.includes("different")) {
        return failure("A nova senha precisa ser diferente da atual.");
      }
      if (error.message.includes("at least")) {
        return failure("A nova senha precisa de pelo menos 8 caracteres.");
      }
      return failure("Não foi possível alterar a senha. Tente novamente.");
    }

    revalidatePath("/painel/cadastro");
    return { ok: true, data: null };
  } catch (error) {
    rethrowIfRedirect(error);
    console.error("[profile] trocar senha:", error);
    return failure("Erro inesperado. Tente novamente.");
  }
}
