"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { relatedStoreSkus, selectStoreSuggestions } from "@/lib/store-recommendations";
import type { StoreProduct } from "@/lib/store";

const requestSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(50),
  mode: z.enum(["cash", "coins"]),
});

const columns = "id,name,sku,category,description,stock,image_path,delivery_kind,cash_price,points_cost";

export async function getStoreSuggestions(input: unknown): Promise<StoreProduct[]> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return [];
  const { ids, mode } = parsed.data;
  const db = createAdminClient();
  const eligible = () => db.from("loyalty_rewards").select(columns)
    .eq("active", true).eq("archived", false)
    .is("mixed_cash_price", null).is("mixed_points_cost", null);
  const [settings, anchors] = await Promise.all([
    db.from("loyalty_settings").select("active").eq("id", true).maybeSingle(),
    eligible().in("id", ids),
  ]);
  if (!settings.data?.active || anchors.error || !anchors.data?.length) return [];
  const byId = new Map(anchors.data.map(product => [product.id, product]));
  const ordered = ids.flatMap(id => {
    const product = byId.get(id);
    return product ? [product] : [];
  });
  const skus = [...new Set(ordered.flatMap(product => relatedStoreSkus(product.sku ?? "")))];
  if (!skus.length) return [];
  const { data, error } = await eligible().in("sku", skus).or("stock.is.null,stock.gt.0");
  if (error || !data) return [];
  return selectStoreSuggestions(ordered, data, ids, mode);
}
