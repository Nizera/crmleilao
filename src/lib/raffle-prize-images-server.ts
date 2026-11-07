import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
/** IDs must come from a session-authorized campaign detail or own-awards RPC. Never returns numbers/buyers. */
export async function readPrizeImages(prizeIds: string[], awardIds: string[] = []) {
  const photos = new Map<string, string[]>();
  const db = createAdminClient();
  if (prizeIds.length) {
    const { data, error } = await db.from("raffle_prizes").select("id,image_urls").in("id", prizeIds.slice(0, 200));
    if (error && error.code !== "42703") throw new Error("Não foi possível carregar as fotos dos prêmios.");
    for (const row of data ?? []) photos.set(row.id, row.image_urls ?? []);
  }
  if (awardIds.length) {
    const { data, error } = await db.from("raffle_awards").select("id,prize:raffle_prizes(image_urls)").in("id", awardIds.slice(0, 200));
    if (error && error.code !== "42703") throw new Error("Não foi possível carregar as fotos dos prêmios.");
    for (const row of data ?? []) { const prize = row.prize as unknown as { image_urls?: string[] } | null; photos.set(row.id, prize?.image_urls ?? []); }
  }
  return photos;
}
