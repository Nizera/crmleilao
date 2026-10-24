"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireCustomer } from "@/lib/dal";

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const optionalNumber = (raw: string) => raw === "" ? null : Number(raw);
const fail = (message: string, section = ""): never => redirect(`/admin/fidelidade${section}?erro=${encodeURIComponent(message)}`);

export async function saveLoyaltySettings(form: FormData) {
  const { profile } = await requireAdmin();
  if (profile.role === "viewer") fail("Seu perfil é somente leitura.", "/configuracao");
  const active = form.get("active") === "on";
  const ranking = form.get("ranking_enabled") === "on";
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_loyalty_settings", {
    p_active: active,
    p_points_per_real: null,
    p_ranking_enabled: ranking,
    p_note: text(form, "note") || null,
  });
  if (error) fail(`Falha ao salvar as regras: ${error.message}`, "/configuracao");
  revalidatePath("/admin/fidelidade"); revalidatePath("/painel/loja"); revalidatePath("/painel/ranking"); revalidatePath("/painel");
  redirect("/admin/fidelidade/configuracao?salvo=1");
}

export async function saveLoyaltyReward(form: FormData) {
  const { profile } = await requireAdmin();
  if (profile.role === "viewer") fail("Seu perfil é somente leitura.", "/recompensas");
  const id = text(form, "id");
  const name = text(form, "name");
  const pointsCost = optionalNumber(text(form, "points_cost"));
  const internalCost = optionalNumber(text(form, "internal_cost"));
  const stock = optionalNumber(text(form, "stock"));
  const active = form.get("active") === "on";
  const rewardId = id || crypto.randomUUID();
  const oldImagePath = text(form, "image_path");
  const removeImage = form.get("remove_image") === "on";
  const image = form.get("image");
  if (name.length < 2 || name.length > 120) fail("O nome da recompensa deve ter de 2 a 120 caracteres.", "/recompensas");
  if (pointsCost !== null && (!Number.isInteger(pointsCost) || pointsCost < 1)) fail("O preço em pontos deve ser um inteiro positivo.", "/recompensas");
  if (internalCost !== null && (!Number.isFinite(internalCost) || internalCost < 0)) fail("Informe um custo interno válido.", "/recompensas");
  if (stock !== null && (!Number.isInteger(stock) || stock < 0)) fail("O estoque deve ser um inteiro igual ou maior que zero.", "/recompensas");
  if (active && (pointsCost === null || internalCost === null)) fail("Para publicar, defina o preço em pontos e o custo interno (use zero se não houver custo).", "/recompensas");
  if (oldImagePath && !oldImagePath.startsWith(`loyalty-rewards/${rewardId}/`)) fail("Imagem de recompensa inválida.", "/recompensas");
  if (image instanceof File && image.size > 0 && !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(image.type)) fail("Use uma imagem JPG, PNG, WebP ou AVIF.", "/recompensas");
  if (image instanceof File && image.size > 3_500_000) fail("A imagem deve ter até 3,5 MB.", "/recompensas");
  const supabase = await createClient();
  let uploadedPath: string | null = null;
  if (image instanceof File && image.size > 0) {
    const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" } as Record<string, string>)[image.type];
    uploadedPath = `loyalty-rewards/${rewardId}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from("lot-images").upload(uploadedPath, image, { contentType: image.type, upsert: false });
    if (uploadError) fail(`Falha ao enviar imagem: ${uploadError.message}`, "/recompensas");
  }
  const imagePath = uploadedPath ?? (removeImage ? null : oldImagePath || null);
  const baseValues = { name, description: text(form, "description") || null, points_cost: pointsCost, internal_cost: internalCost, stock, active, updated_at: new Date().toISOString() };
  const save = (withImage: boolean) => {
    const values = withImage ? { ...baseValues, image_path: imagePath } : baseValues;
    return id
      ? supabase.from("loyalty_rewards").update(values).eq("id", id)
      : supabase.from("loyalty_rewards").insert({ ...values, id: rewardId, created_by: profile.id });
  };
  let result = await save(true);
  // Keep the existing catalog editable if the optional image migration has not
  // been applied yet; image actions still report the migration error normally.
  if (result.error?.message.includes("image_path") && !uploadedPath && !removeImage && !oldImagePath) result = await save(false);
  if (result.error) {
    if (uploadedPath) await supabase.storage.from("lot-images").remove([uploadedPath]);
    fail(`Falha ao salvar recompensa: ${result.error.message}`, "/recompensas");
  }
  if (oldImagePath && oldImagePath !== imagePath) await supabase.storage.from("lot-images").remove([oldImagePath]);
  revalidatePath("/admin/fidelidade"); revalidatePath("/painel/loja");
  redirect("/admin/fidelidade/recompensas?salvo=1");
}

export async function requestLoyaltyRedemption(form: FormData) {
  await requireCustomer();
  const rewardId = text(form, "reward_id");
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_loyalty_redemption", { p_reward_id: rewardId });
  if (error) redirect(`/painel/loja?erro=${encodeURIComponent(error.message.replace(/^.*?: /, ""))}`);
  revalidatePath("/painel/loja"); revalidatePath("/admin/fidelidade");
  redirect("/painel/loja?resgatado=1");
}

export async function handleLoyaltyRedemption(form: FormData) {
  const { profile } = await requireAdmin();
  if (profile.role === "viewer") fail("Seu perfil é somente leitura.", "/resgates");
  const supabase = await createClient();
  const { error } = await supabase.rpc("handle_loyalty_redemption", {
    p_redemption_id: text(form, "redemption_id"),
    p_status: text(form, "status"),
    p_note: text(form, "admin_note") || null,
  });
  if (error) fail(`Falha ao atualizar resgate: ${error.message}`, "/resgates");
  revalidatePath("/admin/fidelidade"); revalidatePath("/painel/loja");
  redirect("/admin/fidelidade/resgates?salvo=1");
}

export async function adjustLoyaltyPoints(form: FormData) {
  const { profile } = await requireAdmin();
  if (profile.role === "viewer") fail("Seu perfil é somente leitura.", "/extrato");
  const points = Number(text(form, "points"));
  const customerId = text(form, "customer_id");
  const note = text(form, "note");
  if (!Number.isInteger(points) || points === 0 || Math.abs(points) > 1000000) fail("Ajuste inválido: informe um número inteiro diferente de zero.", "/extrato");
  if (note.length < 4 || note.length > 500) fail("Explique o motivo do ajuste (4 a 500 caracteres).", "/extrato");
  const supabase = await createClient();
  const { error } = await supabase.rpc("adjust_loyalty_points", { p_customer_id: customerId, p_points: points, p_note: note });
  if (error) fail(`Falha ao lançar ajuste: ${error.message}`, "/extrato");
  revalidatePath("/admin/fidelidade"); revalidatePath("/painel/loja");
  redirect("/admin/fidelidade/extrato?salvo=1");
}

export async function updateLoyaltyRankingVisibility(form: FormData) {
  const { customer } = await requireCustomer();
  const supabase = await createClient();
  const { error } = await supabase.from("customers").update({ loyalty_rank_visible: form.get("visible") === "on" }).eq("id", customer.id);
  if (error) redirect(`/painel/ranking?erro=${encodeURIComponent("Não foi possível atualizar a preferência de ranking.")}`);
  revalidatePath("/painel/ranking");
  redirect("/painel/ranking?salvo=1");
}
