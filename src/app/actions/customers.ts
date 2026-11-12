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
      address_cep: formData.get("address_cep") ?? "",
      address_street: formData.get("address_street") ?? "",
      address_number: formData.get("address_number") ?? "",
      address_complement: formData.get("address_complement") ?? "",
      address_district: formData.get("address_district") ?? "",
      address_city: formData.get("address_city") ?? "",
      address_state: formData.get("address_state") ?? "",
      notes: formData.get("notes") ?? "",
    });

    if (!parsed.success) {
      return failure(parsed.error.issues[0]?.message ?? "Dados inválidos.");
    }

    const phone = normalizePhone(parsed.data.phone);
    if (!phone) return failure("WhatsApp inválido.");

    const supabase = await createClient();
    const id = parsed.data.id || null;

    let duplicateQuery = supabase
      .from("customers")
      .select("id")
      .eq("phone_e164", phone);
    if (id) duplicateQuery = duplicateQuery.neq("id", id);
    const duplicate = await duplicateQuery.maybeSingle();

    if (duplicate.error) {
      return failure(`Falha ao verificar telefone: ${duplicate.error.message}`);
    }
    if (duplicate.data) {
      return failure("Já existe um cliente com este WhatsApp.");
    }

    const row = {
      name: parsed.data.name,
      phone_e164: phone,
      email: parsed.data.email?.toLowerCase() || null,
      cpf_cnpj: parsed.data.cpf_cnpj?.replace(/\D/g, "") || null,

    };

    const address = Object.fromEntries(
      ["address_cep", "address_street", "address_number", "address_complement", "address_district", "address_city", "address_state"]
        .filter(key => formData.has(key))
        .map(key => {
          let value = String(formData.get(key) ?? "").trim();
          if (key === "address_cep") value = value.replace(/\D/g, "");
          if (key === "address_state") value = value.toUpperCase();
          return [key, value || null];
        }),
    );
    Object.assign(row, address);
    if (row.email) {
      let emailQuery = supabase.from("customers").select("id").ilike("email", row.email.replace(/[%_]/g, c => "\\" + c));
      if (id) emailQuery = emailQuery.neq("id", id);
      const emailMatch = await emailQuery.limit(1);
      if (emailMatch.error) return failure("Não foi possível conferir o e-mail. Tente novamente.");
      if (emailMatch.data?.length) return failure("Já existe um cliente com este e-mail.");
    }
    let savedId: string;

    if (id) {
      // phone_e164 deixou de ser editavel por sessao (migracao 0014): este
      // caminho usa o admin client — o guard requireAdmin() acima ja passou.
      const admin = createAdminClient();
      const fields = "id,auth_user_id,updated_at,name,phone_e164,email,cpf_cnpj,address_cep,address_street,address_number,address_complement,address_district,address_city,address_state";
      const previous = await admin.from("customers").select(fields).eq("id", id).maybeSingle();
      if (previous.error || !previous.data) return failure("Não foi possível carregar o cliente. Atualize a página.");
      const old = previous.data;
      const emailChanged = (old.email ?? "").trim().toLowerCase() !== (row.email ?? "");
      if (old.auth_user_id && emailChanged && !row.email) return failure("Informe um e-mail válido para manter o acesso deste cliente.");
      const { data, error } = await admin.from("customers").update(row).eq("id", id)
        .eq("updated_at", old.updated_at).select("id,updated_at").maybeSingle();
      if (error) return failure(error.code === "23505" ? "Este e-mail ou WhatsApp já está em uso." : "Não foi possível salvar o cliente.");
      if (!data) return failure("O cadastro mudou. Atualize a página antes de salvar novamente.");
      if (old.auth_user_id && emailChanged && row.email) {
        const auth = await admin.auth.admin.updateUserById(old.auth_user_id, { email: row.email, email_confirm: true }).catch(() => ({ error: { message: "Falha ao confirmar o e-mail de acesso" } }));
        if (auth.error) {
          const { id: _id, auth_user_id: _auth, updated_at: _updated, ...restore } = old;
          void _id; void _auth; void _updated;
          const rollback = await admin.from("customers").update(restore).eq("id", id).eq("updated_at", data.updated_at).select("id").maybeSingle();
          revalidateClientPages(id);
          return failure(rollback.error || !rollback.data
            ? "O e-mail de acesso não foi alterado. O cadastro mudou durante a operação; confira os dados antes de repetir."
            : "Não foi possível alterar o e-mail de acesso. Confira se ele já pertence a outra conta. Os dados anteriores foram preservados.");
        }
      }

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
  revalidatePath("/admin/envios");
  revalidatePath("/painel", "layout");
  revalidatePath("/admin/lotes");
}
