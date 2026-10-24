import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type LoyaltySettings = {
  active: boolean;
  points_per_real: number | null;
  points_expire_days: number | null;
  ranking_enabled: boolean;
};
export type LoyaltyReward = {
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

export async function getCustomerLoyaltyData(customerId: string) {
  const supabase = await createClient();
  const [{ data: settings }, { data: ledger }, { data: rewards }, { data: redemptions }, { data: customer }, { data: balanceData }] = await Promise.all([
    supabase.from("loyalty_settings").select("active, points_per_real, points_expire_days, ranking_enabled").eq("id", true).maybeSingle(),
    supabase.from("loyalty_ledger").select("id, points, kind, note, created_at").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(30),
    supabase.from("loyalty_rewards").select("*").eq("active", true).order("created_at", { ascending: false }),
    supabase.from("loyalty_redemptions").select("id, reward_name, points_cost, status, admin_note, created_at").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(20),
    supabase.from("customers").select("loyalty_rank_visible").eq("id", customerId).single(),
    supabase.rpc("get_customer_loyalty_balance", { p_customer_id: customerId }),
  ]);
  const entries = ledger ?? [];
  const balance = Number(balanceData ?? 0);
  let tierLeaders: LoyaltyTierLeader[] = [];
  let totalSpent = 0;
  if (settings?.active && settings.ranking_enabled) {
    const { data } = await supabase.rpc("get_loyalty_tier_leaders");
    tierLeaders = (data ?? []) as LoyaltyTierLeader[];
  }
  for (let from = 0; ; from += 1000) {
    const { data: paidLots, error } = await supabase
      .from("lots")
      .select("arremate_value")
      .eq("customer_id", customerId)
      .in("status", ["paid", "shipped", "delivered"])
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    totalSpent += (paidLots ?? []).reduce(
      (sum, lot) => sum + Number(lot.arremate_value),
      0,
    );
    if (!paidLots || paidLots.length < 1000) break;
  }
  return {
    settings: (settings as LoyaltySettings | null) ?? DEFAULT_SETTINGS,
    ledger: entries,
    balance,
    rewards: (rewards ?? []) as LoyaltyReward[],
    redemptions: redemptions ?? [],
    rankVisible: customer?.loyalty_rank_visible ?? false,
    tierLeaders,
    totalSpent,
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
