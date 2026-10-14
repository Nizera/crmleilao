"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { parseAdminRole, type AdminRole } from "@/lib/roles";
import { rethrowIfRedirect, type ActionResult } from "@/lib/result";
import { createAdminClient } from "@/lib/supabase/admin";

const failure = (error: string): ActionResult<never> => ({ ok: false, error });

type TargetRow = { id: string; role: AdminRole };

async function getTarget(
  memberId: string,
): Promise<{ target: TargetRow | null; error?: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("admin_profiles")
    .select("id, role")
    .eq("id", memberId)
    .maybeSingle();

  if (error) return { target: null, error: `Falha ao ler equipe: ${error.message}` };
  return { target: data as TargetRow | null };
}

/** Bloqueia rebaixar/remover o último dono (trava de segurança do sistema). */
async function assertNotLastOwner(target: TargetRow, nextRole?: AdminRole) {
  if (target.role !== "owner") return null;
  if (nextRole === "owner") return null;

  const admin = createAdminClient();
  const { count, error } = await admin
    .from("admin_profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "owner");

  if (error) return `Falha ao verificar donos: ${error.message}`;
  if ((count ?? 0) <= 1) {
    return "Promova outro dono antes de alterar o último dono.";
  }
  return null;
}

export async function updateMemberRole(
  memberId: string,
  role: string,
): Promise<ActionResult<{ role: AdminRole }>> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role !== "owner") {
      return failure("Apenas o dono altera a equipe.");
    }

    const nextRole = parseAdminRole(role);
    if (!nextRole) return failure("Papel inválido.");

    if (memberId === profile.id) {
      return failure("Você não pode alterar o próprio papel.");
    }

    const { target, error } = await getTarget(memberId);
    if (error) return failure(error);
    if (!target) return failure("Membro não encontrado.");

    const lastOwnerError = await assertNotLastOwner(target, nextRole);
    if (lastOwnerError) return failure(lastOwnerError);

    const admin = createAdminClient();
    const { error: updateError } = await admin
      .from("admin_profiles")
      .update({ role: nextRole })
      .eq("id", memberId);

    if (updateError) {
      return failure(`Falha ao atualizar papel: ${updateError.message}`);
    }

    revalidatePath("/admin/configuracao");
    return { ok: true, data: { role: nextRole } };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(error instanceof Error ? error.message : "Erro inesperado.");
  }
}

export async function removeMember(
  memberId: string,
): Promise<ActionResult<null>> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role !== "owner") {
      return failure("Apenas o dono altera a equipe.");
    }
    if (memberId === profile.id) {
      return failure("Você não pode remover a si mesmo.");
    }

    const { target, error } = await getTarget(memberId);
    if (error) return failure(error);
    if (!target) return failure("Membro não encontrado.");

    const lastOwnerError = await assertNotLastOwner(target);
    if (lastOwnerError) return failure(lastOwnerError);

    const admin = createAdminClient();
    const { error: deleteError } = await admin
      .from("admin_profiles")
      .delete()
      .eq("id", memberId);

    if (deleteError) {
      return failure(`Falha ao remover acesso: ${deleteError.message}`);
    }

    revalidatePath("/admin/configuracao");
    return { ok: true, data: null };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(error instanceof Error ? error.message : "Erro inesperado.");
  }
}
