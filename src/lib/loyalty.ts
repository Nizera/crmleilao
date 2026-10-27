import "server-only";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

export type LoyaltySettings = {
  active: boolean;
  points_per_real: number | null;
  points_expire_days: number | null;
  ranking_enabled: boolean;
};
export type LoyaltyReward = {
  delivery_kind?: 'physical' | 'digital';
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

export async function getCustomerLoyaltyRankingData(customerId: string) {
  const supabase = await createClient();
  const [{ data: settings,error:settingsError }, { data: customer,error:customerError }] = await Promise.all([
    supabase.from("loyalty_settings").select("active, points_per_real, points_expire_days, ranking_enabled").eq("id", true).maybeSingle(),
    supabase.from("customers").select("loyalty_rank_visible").eq("id", customerId).single(),
  ]);
  if(settingsError || customerError)throw new Error('Não foi possível carregar o ranking.');
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
