"use server";

import { revalidatePath, updateTag } from "next/cache";

import { requireAdmin } from "@/lib/dal";
import { customerFormSchema, normalizePhone } from "@/lib/customers";
import { deleteNotes, saveNote } from "@/lib/notes";
import { rethrowIfRedirect, type ActionResult } from "@/lib/result";
import { createAdminClient } from "@/lib/supabase/admin";
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
    };

    let savedId: string;

    if (id) {
      // phone_e164 deixou de ser editavel por sessao (migracao 0014): este
      // caminho usa o admin client — o guard requireAdmin() acima ja passou.
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("customers")
        .update(row)
        .eq("id", id)
        .select("id")
        .maybeSingle();

      if (error) return failure(`Falha ao salvar cliente: ${error.message}`);
      if (!data) return failure("Cliente não encontrado.");

      savedId = data.id;
    } else {
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

      savedId = data.id;
    }

    try {
      await saveNote("customer", savedId, parsed.data.notes ?? "", profile.id);
    } catch (noteError) {
      return failure(
        noteError instanceof Error ? noteError.message : "Erro inesperado.",
      );
    }

    revalidateClientPages(savedId);
    return { ok: true, data: { id: savedId } };
  } catch (error) {
    rethrowIfRedirect(error);
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

    try {
      await deleteNotes("customer", id);
    } catch {
      // Cliente já excluído: nota órfã não derruba a operação.
    }

    updateTag("dashboard");
    revalidatePath("/admin/clientes");
    revalidatePath("/admin/lotes");
    return { ok: true, data: null };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(error instanceof Error ? error.message : "Erro inesperado.");
  }
}

function revalidateClientPages(id: string) {
  updateTag("dashboard");
  revalidatePath("/admin/clientes");
  revalidatePath(`/admin/clientes/${id}`);
  revalidatePath("/admin/lotes");
}
