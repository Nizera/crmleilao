"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/dal";
import { customerFormSchema, normalizePhone } from "@/lib/customers";
import type { ActionResult } from "@/lib/result";
import { createClient } from "@/lib/supabase/server";

const failure = (error: string): ActionResult<never> => ({ ok: false, error });

export async function saveCustomer(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role === "viewer") {
      return failure("Seu perfil é somente leitura.");
    }

    const parsed = customerFormSchema.safeParse({
      id: formData.get("id") ?? "",
      name: formData.get("name") ?? "",
      phone: formData.get("phone") ?? "",
      email: formData.get("email") ?? "",
      cpf_cnpj: formData.get("cpf_cnpj") ?? "",
      notes: formData.get("notes") ?? "",
    });

    if (!parsed.success) {
      return failure(parsed.error.issues[0]?.message ?? "Dados inválidos.");
    }

    const phone = normalizePhone(parsed.data.phone);
    if (!phone) return failure("WhatsApp inválido.");

    const supabase = await createClient();
    const id = parsed.data.id || null;

    const duplicate = await supabase
      .from("customers")
      .select("id")
      .eq("phone_e164", phone)
      .neq("id", id ?? "")
      .maybeSingle();

    if (duplicate.error) {
      return failure(`Falha ao verificar telefone: ${duplicate.error.message}`);
    }
    if (duplicate.data) {
      return failure("Já existe um cliente com este WhatsApp.");
    }

    const row = {
      name: parsed.data.name,
      phone_e164: phone,
      email: parsed.data.email || null,
      cpf_cnpj: parsed.data.cpf_cnpj || null,
      notes: parsed.data.notes || null,
    };

    if (id) {
      const { data, error } = await supabase
        .from("customers")
        .update(row)
        .eq("id", id)
        .select("id")
        .maybeSingle();

      if (error) return failure(`Falha ao salvar cliente: ${error.message}`);
      if (!data) return failure("Cliente não encontrado.");

      revalidateClientPages(id);
      return { ok: true, data: { id } };
    }

    const { data, error } = await supabase
      .from("customers")
      .insert(row)
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") {
        return failure("Já existe um cliente com este WhatsApp.");
      }
      return failure(`Falha ao criar cliente: ${error.message}`);
    }

    revalidateClientPages(data.id);
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Erro inesperado.");
  }
}

export async function deleteCustomer(
  id: string,
): Promise<ActionResult<null>> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role === "viewer") {
      return failure("Seu perfil é somente leitura.");
    }

    const supabase = await createClient();

    const { count, error: lotsError } = await supabase
      .from("lots")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", id);

    if (lotsError) {
      return failure(`Falha ao verificar lotes: ${lotsError.message}`);
    }
    if ((count ?? 0) > 0) {
      return failure(
        `Este cliente tem ${count} lote(s). Cancele os lotes antes de excluir.`,
      );
    }

    const { error } = await supabase.from("customers").delete().eq("id", id);
    if (error) return failure(`Falha ao excluir cliente: ${error.message}`);

    revalidatePath("/admin/clientes");
    revalidatePath("/admin/lotes");
    return { ok: true, data: null };
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Erro inesperado.");
  }
}

function revalidateClientPages(id: string) {
  revalidatePath("/admin/clientes");
  revalidatePath(`/admin/clientes/${id}`);
  revalidatePath("/admin/lotes");
}
