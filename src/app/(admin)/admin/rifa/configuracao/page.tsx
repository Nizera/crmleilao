import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { RaffleSettings } from "@/components/raffles/raffle-admin";
import { RaffleUnavailable } from "@/components/raffles/raffle-shared";
export const metadata = { title: "Configurações de rifas" };
export const instant = false;
export default async function Page() {
  const { profile } = await requireAdmin();
  const { data, error } = await (await createClient()).from("raffle_settings").select("purchases_enabled").eq("id", true).single();
  return <main className="grid gap-5 p-4 md:p-8"><h1 className="text-2xl font-bold">Configurações de rifas</h1>{error ? <RaffleUnavailable /> : <RaffleSettings enabled={data.purchases_enabled} owner={profile.role === "owner"} />}</main>;
}
