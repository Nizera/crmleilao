"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireCustomer } from "@/lib/dal";

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const optionalNumber = (raw: string) => raw === "" ? null : Number(raw);
const fail = (message: string): never => redirect(`/admin/fidelidade?erro=${encodeURIComponent(message)}`);

export async function saveLoyaltySettings(form: FormData) {
  const { profile } = await requireAdmin();
  if (profile.role === "viewer") fail("Seu perfil é somente leitura.");
  const rate = optionalNumber(text(form, "points_per_real"));
  const active = form.get("active") === "on";
  const ranking = form.get("ranking_enabled") === "on";
  if (rate !== null && (!Number.isFinite(rate) || rate <= 0 || rate > 10000)) fail("Informe uma regra de ganho válida.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_loyalty_settings", {
    p_active: active,
    p_points_per_real: rate,
    p_ranking_enabled: ranking,
    p_note: text(form, "note") || null,
  });
  if (error) fail(`Falha ao salvar as regras: ${error.message}`);
  revalidatePath("/admin/fidelidade"); revalidatePath("/painel/loja"); revalidatePath("/painel");
  redirect("/admin/fidelidade?salvo=1");
}

export async function saveLoyaltyReward(form: FormData) {
  const { profile } = await requireAdmin();
  if (profile.role === "viewer") fail("Seu perfil é somente leitura.");
  const id = text(form, "id");
  const name = text(form, "name");
  const pointsCost = optionalNumber(text(form, "points_cost"));
  const internalCost = optionalNumber(text(form, "internal_cost"));
  const stock = optionalNumber(text(form, "stock"));
  const active = form.get("active") === "on";
  if (name.length < 2 || name.length > 120) fail("O nome da recompensa deve ter de 2 a 120 caracteres.");
  if (pointsCost !== null && (!Number.isInteger(pointsCost) || pointsCost < 1)) fail("O preço em pontos deve ser um inteiro positivo.");
  if (internalCost !== null && (!Number.isFinite(internalCost) || internalCost < 0)) fail("Informe um custo interno válido.");
  if (stock !== null && (!Number.isInteger(stock) || stock < 0)) fail("O estoque deve ser um inteiro igual ou maior que zero.");
  if (active && (pointsCost === null || internalCost === null)) fail("Para publicar, defina o preço em pontos e o custo interno (use zero se não houver custo).");
  const supabase = await createClient();
  const values = { name, description: text(form, "description") || null, points_cost: pointsCost, internal_cost: internalCost, stock, active, updated_at: new Date().toISOString() };
  const result = id
    ? await supabase.from("loyalty_rewards").update(values).eq("id", id)
    : await supabase.from("loyalty_rewards").insert({ ...values, created_by: profile.id });
  if (result.error) fail(`Falha ao salvar recompensa: ${result.error.message}`);
  revalidatePath("/admin/fidelidade"); revalidatePath("/painel/loja");
  redirect("/admin/fidelidade?salvo=1");
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
  if (profile.role === "viewer") fail("Seu perfil é somente leitura.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("handle_loyalty_redemption", {
    p_redemption_id: text(form, "redemption_id"),
    p_status: text(form, "status"),
    p_note: text(form, "admin_note") || null,
  });
  if (error) fail(`Falha ao atualizar resgate: ${error.message}`);
  revalidatePath("/admin/fidelidade"); revalidatePath("/painel/loja");
  redirect("/admin/fidelidade?salvo=1");
}

export async function adjustLoyaltyPoints(form: FormData) {
  const { profile } = await requireAdmin();
  if (profile.role === "viewer") fail("Seu perfil é somente leitura.");
  const points = Number(text(form, "points"));
  const customerId = text(form, "customer_id");
  const note = text(form, "note");
  if (!Number.isInteger(points) || points === 0 || Math.abs(points) > 1000000) fail("Ajuste inválido: informe um número inteiro diferente de zero.");
  if (note.length < 4 || note.length > 500) fail("Explique o motivo do ajuste (4 a 500 caracteres).");
  const supabase = await createClient();
  const { error } = await supabase.rpc("adjust_loyalty_points", { p_customer_id: customerId, p_points: points, p_note: note });
  if (error) fail(`Falha ao lançar ajuste: ${error.message}`);
  revalidatePath("/admin/fidelidade"); revalidatePath("/painel/loja");
  redirect("/admin/fidelidade?salvo=1");
}

export async function updateLoyaltyRankingVisibility(form: FormData) {
  const { customer } = await requireCustomer();
  const supabase = await createClient();
  const { error } = await supabase.from("customers").update({ loyalty_rank_visible: form.get("visible") === "on" }).eq("id", customer.id);
  if (error) redirect(`/painel/loja?erro=${encodeURIComponent("Não foi possível atualizar a preferência de ranking.")}`);
  revalidatePath("/painel/loja");
  redirect("/painel/loja?salvo=1");
}
