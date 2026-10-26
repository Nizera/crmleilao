"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireCustomer } from "@/lib/dal";
import { orderHistoryFilters, orderHistoryHref } from "@/lib/order-history";

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
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
  revalidatePath("/admin/fidelidade"); revalidatePath("/admin/fidelidade/resgates"); revalidatePath("/painel/loja");
  const filters = orderHistoryFilters(Object.fromEntries(new URLSearchParams(text(form,"return_query"))));
  const href = orderHistoryHref(filters);
  redirect(`${href}${href.includes("?") ? "&" : "?"}salvo=1`);
}

export async function updateLoyaltyRankingVisibility(form: FormData) {
  const { customer } = await requireCustomer();
  const supabase = await createClient();
  const { data, error } = await supabase.from("customers")
    .update({ loyalty_rank_visible: form.get("visible") === "on" })
    .eq("id", customer.id)
    .select("id")
    .maybeSingle();
  if (error || !data) redirect(`/painel/ranking?erro=${encodeURIComponent("Não foi possível atualizar a preferência de ranking.")}`);
  revalidatePath("/painel/ranking");
  redirect("/painel/ranking?salvo=1");
}
