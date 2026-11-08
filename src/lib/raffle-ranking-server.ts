import "server-only";
import { createClient } from "@/lib/supabase/server";

export type RaffleBuyer = { name: string; quantity: number; position: number };

export async function getRaffleBuyerRanking(campaign: string): Promise<RaffleBuyer[] | null> {
  const {data,error}=await(await createClient()).rpc("get_public_raffle_buyer_ranking",{p_campaign:campaign});
  if(error){console.error("[raffle-ranking] consulta indisponível",error.code);return null;}
  return data as RaffleBuyer[];
}
