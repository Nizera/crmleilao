import "server-only";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type LoyaltySettings = {
  active: boolean;
  points_per_real: number | null;
  points_expire_days: number | null;
  ranking_enabled: boolean;
};
export type LoyaltyReward = {
  sku?: string;
  category?: string;
  image_paths?: string[];
  archived?: boolean;
  low_stock_threshold?: number | null;
  updated_at?: string;
  cash_price?: number | null;
  mixed_cash_price?: number | null;
  mixed_points_cost?: number | null;
  id: string;
  name: string;
  description: string | null;
  points_cost: number | null;
  internal_cost: number | null;
  stock: number | null;
  active: boolean;
  image_path: string | null;
};
export type LoyaltyTierLeader = {
  tier_key: string;
  tier_name: string;
  customer_name: string | null;
  points: number | string | null;
};

const DEFAULT_SETTINGS: LoyaltySettings = {
  active: false, points_per_real: null, points_expire_days: null, ranking_enabled: false,
};

export const getCustomerCaracoinsBalance = cache(async (customerId: string): Promise<number | null> => {
  const db = await createClient();
  const { data, error } = await db.rpc("get_customer_loyalty_balance", { p_customer_id: customerId });
  return error ? null : Number(data ?? 0);
});

export async function getCustomerLoyaltyData(customerId: string) {
  const supabase = await createClient();
  const [{ data: settings }, { data: ledger }, { data: rewards }, { data: redemptions }, { data: balanceData }] = await Promise.all([
    supabase.from("loyalty_settings").select("active, points_per_real, points_expire_days, ranking_enabled").eq("id", true).maybeSingle(),
    supabase.from("loyalty_ledger").select("id, points, kind, note, created_at").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(30),
    supabase.from("loyalty_rewards").select("id,name,description,points_cost,stock,active,image_path,image_paths,sku,category,cash_price,mixed_cash_price,mixed_points_cost").eq("active", true).order("created_at", { ascending: false }),
    supabase.from("loyalty_redemptions").select("id, reward_name, points_cost, status, admin_note, created_at").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(20),
    supabase.rpc("get_customer_loyalty_balance", { p_customer_id: customerId }),
  ]);
  const entries = ledger ?? [];
  const balance = Number(balanceData ?? 0);
  return {
    settings: (settings as LoyaltySettings | null) ?? DEFAULT_SETTINGS,
    ledger: entries,
    balance,
    rewards: (rewards ?? []) as LoyaltyReward[],
    redemptions: redemptions ?? [],
  };
}

export async function getCustomerLoyaltyRankingData(customerId: string) {
  const supabase = await createClient();
  const [{ data: settings }, { data: customer }] = await Promise.all([
    supabase.from("loyalty_settings").select("active, points_per_real, points_expire_days, ranking_enabled").eq("id", true).maybeSingle(),
    supabase.from("customers").select("loyalty_rank_visible").eq("id", customerId).single(),
  ]);
  const resolvedSettings = (settings as LoyaltySettings | null) ?? DEFAULT_SETTINGS;
  let tierLeaders: LoyaltyTierLeader[] = [];
  if (resolvedSettings.active && resolvedSettings.ranking_enabled) {
    const { data, error } = await supabase.rpc("get_loyalty_tier_leaders");
    if (error) throw error;
    tierLeaders = (data ?? []) as LoyaltyTierLeader[];
  }
  const { data: earnedPoints, error: earnedPointsError } = await supabase.rpc(
    "get_customer_loyalty_earned_points",
    { p_customer_id: customerId },
  );
  if (earnedPointsError) throw earnedPointsError;
  return {
    settings: resolvedSettings,
    rankVisible: customer?.loyalty_rank_visible ?? false,
    tierLeaders,
    rankPoints: Number(earnedPoints ?? 0),
  };
}

export async function getAdminLoyaltyData() {
  const supabase = createAdminClient();
  const authed = await createClient();
  const [{ data: settings, error: settingsError }, { data: rewards, error: rewardsError }, { data: redemptions, error: redemptionsError }, { data: ledger, error: ledgerError }, { data: customers, error: customersError }, { data: history, error: historyError }, { data: stats, error: statsError }] = await Promise.all([
    supabase.from("loyalty_settings").select("*").eq("id", true).maybeSingle(),
    supabase.from("loyalty_rewards").select("*").order("created_at", { ascending: false }),
    supabase.from("loyalty_redemptions").select("id, customer_id, reward_id, reward_name, points_cost, status, customer_note, admin_note, created_at, customer:customers(name, phone_e164)").order("created_at", { ascending: false }).limit(100),
    supabase.from("loyalty_ledger").select("id, customer_id, points, kind, lot_id, lot_value, earn_rate, note, created_at, customer:customers(name, phone_e164)").order("created_at", { ascending: false }).limit(200),
    supabase.from("customers").select("id, name, phone_e164").order("name", { ascending: true, nullsFirst: false }).limit(1000),
    supabase.from("loyalty_settings_history").select("id, active, points_per_real, points_expire_days, ranking_enabled, note, effective_at").order("effective_at", { ascending: false }).limit(10),
    authed.rpc("get_loyalty_admin_stats"),
  ]);
  const error = [settingsError, rewardsError, redemptionsError, ledgerError, customersError, historyError, statsError].find(Boolean);
  return { settings: settings as LoyaltySettings | null, rewards: rewards ?? [], redemptions: redemptions ?? [], ledger: ledger ?? [], customers: customers ?? [], history: history ?? [], stats: stats?.[0] ?? null, error: error?.message ?? null };
}
