import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
export type LogisticsShippingItem = { id: string; title: string; quantity: number; moved_at: string | null; source_kind: "raffle" | "replacement"; shipping_declared_value: number };
export async function listLogisticsShippingItems(customer: string, day: string): Promise<LogisticsShippingItem[]> {
  const { data, error } = await createAdminClient().from("logistics_pending")
    .select("id,title,quantity,moved_at,source_kind,shipping_declared_value")
    .eq("customer_id", customer).lte("shipping_date", day).is("shipment_id", null).is("cancelled_at", null).order("id").limit(501);
  if (error) throw new Error("Não foi possível conferir os prêmios e reposições. Confira a migration 0046.");
  if ((data?.length ?? 0) > 500) throw new Error("Há muitos itens avulsos para um pacote. Revise a separação.");
  return data as LogisticsShippingItem[];
}
