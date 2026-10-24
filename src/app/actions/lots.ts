"use server";

import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import {
  getLotById,
  requireAdmin,
  getAppSettings,
  searchCustomers,
  type Customer,
} from "@/lib/dal";
import { toE164 } from "@/lib/phone";
import { createInviteForCustomer } from "@/lib/invites-server";
import { loadNotes, saveNote } from "@/lib/notes";
import { rethrowIfRedirect, type ActionResult } from "@/lib/result";
import { parseLotItems } from "@/lib/stock";
import {
  lotSchema,
  nextShippingDate,
  LOT_STATUSES,
  type Lot,
  type LotStatus,
} from "@/lib/lots";
import { createClient } from "@/lib/supabase/server";

const failure = (error: string): ActionResult<never> => ({ ok: false, error });

async function resolveCustomerId(input: {
  customer_id?: string;
  phone?: string;
  customer_name?: string;
}): Promise<{ id: string; isNew: boolean }> {
  const supabase = await createClient();
  const phone = toE164(input.phone ?? "");

  // O telefone é a fonte da verdade: se mudou, o lote passa para outro cliente.
  if (phone) {
    const { data: existing, error: findError } = await supabase
      .from("customers")
      .select("id, name")
      .eq("phone_e164", phone)
      .maybeSingle();

    if (findError) throw new Error(`Falha ao buscar cliente: ${findError.message}`);

    if (existing) {
      if (!existing.name && input.customer_name) {
        await supabase
          .from("customers")
          .update({ name: input.customer_name })
          .eq("id", existing.id);
      }
      return { id: existing.id, isNew: false };
    }

    const { data: created, error: insertError } = await supabase
      .from("customers")
      .insert({ phone_e164: phone, name: input.customer_name || null })
      .select("id")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        const { data: row } = await supabase
          .from("customers")
          .select("id")
          .eq("phone_e164", phone)
          .single();
        if (row) return { id: row.id, isNew: false };
      }
      throw new Error(`Falha ao cadastrar cliente: ${insertError.message}`);
    }

    return { id: created.id, isNew: true };
  }

  if (input.customer_id) {
    const { data } = await supabase
      .from("customers")
      .select("id")
      .eq("id", input.customer_id)
      .maybeSingle();
    if (data) return { id: data.id, isNew: false };
  }

  throw new Error("Informe o WhatsApp do cliente com DDD.");
}

/**
 * Detalhe completo do lote para abrir o formulário de edição.
 *
 * A listagem do admin é magra (sem itens, fotos e descrição — payload morto
 * para 500+ linhas); sem isto aqui o form abriria vazio e, ao salvar,
 * apagaria figurinhas e fotos do lote.
 */
export async function getLotDetailAction(id: string): Promise<ActionResult<Lot>> {
  try {
    await requireAdmin();
    const lot = await getLotById(id);
    if (!lot) return failure("Lote não encontrado.");

    const notes = await loadNotes("lot", [id]);
    return { ok: true, data: { ...lot, notes: notes.get(id) ?? null } };
  } catch (error) {
    rethrowIfRedirect(error);
    console.error("[lots] detalhe:", error);
    return failure("Não foi possível carregar o lote. Tente de novo.");
  }
}

export async function saveLot(
  formData: FormData,
): Promise<ActionResult<{ id: string; code: string; inviteUrl?: string }>> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role === "viewer") {
      return failure("Seu perfil é somente leitura.");
    }

    const parsed = lotSchema.safeParse(Object.fromEntries(formData.entries()));
    if (!parsed.success) {
      return failure(parsed.error.issues[0]?.message ?? "Dados inválidos.");
    }
    const values = parsed.data;
    const items = parseLotItems(formData.get("items"));

    const customer = await resolveCustomerId(values);
    const customer_id = customer.id;
    const supabase = await createClient();
    const { settings } = await getAppSettings();

    const previous = values.id
      ? await supabase
          .from("lots")
          .select("id, images, moved_at")
          .eq("id", values.id)
          .maybeSingle()
      : null;

    if (values.id && !previous?.data) return failure("Lote não encontrado.");

    const previousImages: string[] = previous?.data?.images ?? [];
    let wasMoved = false;
    if (values.id) {
      const { data: priorItems, error: priorItemsError } = await supabase
        .from("lot_items").select("applied").eq("lot_id", values.id);
      if (priorItemsError) return failure(`Falha ao conferir estoque do lote: ${priorItemsError.message}`);
      wasMoved = Boolean(previous?.data?.moved_at) || (priorItems ?? []).some((item) => item.applied);
    }

    const keep = (() => {
      const raw = formData.get("keep_images");
      if (typeof raw !== "string") return [];
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(
          (path): path is string =>
            typeof path === "string" && previousImages.includes(path),
        );
      } catch {
        return [];
      }
    })();

    const row = {
      customer_id,
      title: values.title,
      description: values.description || null,
      arremate_value: Number(values.arremate_value.replace(",", ".")),
      status: values.status,
      auction_date: values.auction_date,
      shipping_date:
        values.shipping_date ||
        nextShippingDate(values.auction_date, settings.shipping_weekday),
    };

    let lotId: string;
    let code: string;

    if (values.id) {
      const { data, error } = await supabase
        .from("lots")
        .update(row)
        .eq("id", values.id)
        .select("id, code")
        .single();

      if (error) return failure(`Falha ao salvar lote: ${error.message}`);
      lotId = data.id;
      code = data.code;
    } else {
      const { data, error } = await supabase
        .from("lots")
        .insert({ ...row, created_by: profile.id })
        .select("id, code")
        .single();

      if (error) return failure(`Falha ao criar lote: ${error.message}`);
      lotId = data.id;
      code = data.code;
    }

    // Baixa (ou devolução) de estoque: diff atômico no banco.
    const { error: stockError } = await supabase.rpc("reconcile_lot_items", {
      p_lot_id: lotId,
      p_items: items,
      p_apply: wasMoved && ["paid", "shipped", "delivered"].includes(values.status),
    });

    if (stockError) {
      return failure(`Falha no estoque: ${stockError.message}`);
    }
    const remainsMoved = wasMoved && ["paid", "shipped", "delivered"].includes(values.status);
    if (!remainsMoved) {
      const { error: movementError } = await supabase.from("lots")
        .update({ moved_at: null }).eq("id", lotId);
      if (movementError) return failure(`Falha ao atualizar movimentação do lote: ${movementError.message}`);
    }

    // Observações internas: fora da tabela do lote, que o cliente lê na
    // íntegra. Por último: assim uma falha aqui não deixa lote criado sem a
    // baixa de estoque.
    try {
      await saveNote("lot", lotId, values.notes ?? "", profile.id);
    } catch (noteError) {
      return failure(
        noteError instanceof Error ? noteError.message : "Erro inesperado.",
      );
    }

    const files = formData
      .getAll("images")
      .filter((f): f is File => f instanceof File && f.size > 0)
      .slice(0, 6);

    // A Vercel corta o corpo da requisição em 4,5 MB e devolve um 413 sem
    // contexto. Conferir aqui devolve a mensagem que o admin entende.
    const oversized = files.find((file) => file.size > 5_000_000);
    if (oversized) {
      return failure(
        `A imagem "${oversized.name}" tem ${Math.round(oversized.size / 1_000_000)} MB. ` +
          "O envio aceita até 5 MB por foto — remova ou comprima antes de salvar.",
      );
    }
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > 4_000_000) {
      return failure(
        `As ${files.length} fotos somam ${Math.round(totalBytes / 1_000_000)} MB ` +
          "e o envio aceita até 4 MB no total. Remova ou troque algumas imagens.",
      );
    }

    const uploaded: string[] = [];
    for (const file of files) {
      const ext = (file.name.split(".").pop() ?? "jpg")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 8);
      const path = `${lotId}/${crypto.randomUUID()}.${ext || "jpg"}`;

      const { error: uploadError } = await supabase.storage
        .from("lot-images")
        .upload(path, file, { contentType: file.type, upsert: false });

      if (uploadError) {
        return failure(`Falha ao enviar imagem: ${uploadError.message}`);
      }
      uploaded.push(path);
    }

    const finalImages = [...keep, ...uploaded];
    const removed = previousImages.filter((p) => !finalImages.includes(p));
    if (
      JSON.stringify(finalImages) !== JSON.stringify(previousImages) ||
      files.length > 0
    ) {
      const { error: imageError } = await supabase
        .from("lots")
        .update({ images: finalImages })
        .eq("id", lotId);

      if (imageError) {
        return failure(`Falha ao gravar imagens: ${imageError.message}`);
      }

      if (removed.length) {
        await supabase.storage.from("lot-images").remove(removed);
      }
    }

    // Cliente recém-criado pelo lote: nasce com convite de acesso pronto.
    // Se falhar, o lote já está salvo — não derruba a operação.
    let inviteUrl: string | undefined;
    if (customer.isNew) {
      const invite = await createInviteForCustomer(customer.id, profile.id);
      if (invite.ok) inviteUrl = invite.url;
    }

    updateTag("dashboard");
    revalidatePath("/admin/lotes");
    revalidatePath("/admin/estoque");
    revalidatePath("/admin/clientes");
    revalidatePath(`/painel/lotes/${code}`);

    return { ok: true, data: { id: lotId, code, inviteUrl } };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(error instanceof Error ? error.message : "Erro inesperado.");
  }
}

export async function setLotStatus(
  id: string,
  status: LotStatus,
): Promise<ActionResult<{ status: LotStatus }>> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role === "viewer") {
      return failure("Seu perfil é somente leitura.");
    }

    const parsedStatus = z.enum(LOT_STATUSES).safeParse(status);
    if (!parsedStatus.success) return failure("Status inválido.");

    const supabase = await createClient();
    const { data: lot } = await supabase
      .from("lots")
      .select("id, code, paid_at, shipped_at")
      .eq("id", id)
      .maybeSingle();

    if (!lot) return failure("Lote não encontrado.");

    // Estoque primeiro: se falhar, o status não muda e o admin pode repetir.
    const { data: itemRows, error: itemsError } = await supabase
      .from("lot_items")
      .select("stock_item_id, qty, applied")
      .eq("lot_id", id);

    if (itemsError) {
      return failure(`Falha ao ler itens do lote: ${itemsError.message}`);
    }

    const items = (itemRows ?? []).map((row) => ({
      stock_item_id: row.stock_item_id,
      qty: row.qty,
    }));

    if (items.length > 0) {
      const { error: stockError } = await supabase.rpc("reconcile_lot_items", {
        p_lot_id: id,
        p_items: items,
        p_apply: itemRows?.some((item) => item.applied) === true && ["paid", "shipped", "delivered"].includes(status),
      });
      if (stockError) return failure(`Falha no estoque: ${stockError.message}`);
    }

    const patch: Record<string, unknown> = { status: parsedStatus.data };
    if (status === "paid" && !lot.paid_at) patch.paid_at = new Date().toISOString();
    if (status === "shipped" && !lot.shipped_at)
      patch.shipped_at = new Date().toISOString();
    if (status === "pending_payment") {
      patch.paid_at = null;
      patch.shipped_at = null;
    }
    if (status === "cancelled") {
      patch.paid_at = null;
      patch.shipped_at = null;
    }
    if (["pending_payment", "cancelled"].includes(status)) {
      patch.moved_at = null;
    }

    const { error } = await supabase.from("lots").update(patch).eq("id", id);
    if (error) return failure(`Falha ao atualizar status: ${error.message}`);

    updateTag("dashboard");
    revalidatePath("/admin/lotes");
    revalidatePath("/admin/estoque");
    revalidatePath(`/painel/lotes/${lot.code}`);

    return { ok: true, data: { status } };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(error instanceof Error ? error.message : "Erro inesperado.");
  }
}

/**
 * Troca o token de convite por um marcador, dentro da URL.
 *
 * Formas cobertas: `…/painel/convite?token=ABC` (texto puro) e
 * `…%3Ftoken%3DABC` (mesma URL codificada dentro do link do wa.me).
 */
function redactInviteToken(value: string): string {
  return value.replace(/(token(?:%3D|=))[^&\s"']+/gi, "$1REMOVIDO");
}

export async function logWaMessage(input: {
  lot_id?: string;
  customer_id?: string;
  kind: string;
  text_body: string;
  link: string;
}): Promise<ActionResult> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role === "viewer") {
      return failure("Seu perfil é somente leitura.");
    }

    const supabase = await createClient();
    let customer_id: string | null = input.customer_id ?? null;

    if (input.lot_id) {
      const { data } = await supabase
        .from("lots")
        .select("customer_id")
        .eq("id", input.lot_id)
        .maybeSingle();
      customer_id = data?.customer_id ?? null;
    }

    // O convite é token de uso único que abre o painel do cliente. A policy
    // de leitura de `message_log` é `is_admin()` — QUALQUER membro da equipe,
    // inclusive `viewer` — enquanto o link da Configuração é restrito a
    // owner/staff. Sem este corte, um viewer leria o token no histórico e
    // assumiria o painel. O registro fica legível, mas sem o segredo.
    const isInvite = input.kind === "access_invite";
    const text_body = (isInvite ? redactInviteToken(input.text_body) : input.text_body)
      .slice(0, 4000);
    const link = isInvite ? redactInviteToken(input.link) : input.link;

    const { error } = await supabase.from("message_log").insert({
      lot_id: input.lot_id ?? null,
      customer_id,
      kind: input.kind,
      text_body,
      link,
      sent_by: profile.id,
    });

    if (error) return failure(`Falha ao registrar mensagem: ${error.message}`);

    revalidatePath("/admin/lotes");
    return { ok: true, data: null };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(error instanceof Error ? error.message : "Erro inesperado.");
  }
}

export async function searchLotCustomers(
  query: string,
): Promise<ActionResult<Customer[]>> {
  try {
    await requireAdmin();
    return { ok: true, data: await searchCustomers(query) };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(error instanceof Error ? error.message : "Erro inesperado.");
  }
}
