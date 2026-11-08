import { readRaffleNumberStates } from "@/lib/raffle-number-states-server";
import { getRaffleBuyerRanking } from "@/lib/raffle-ranking-server";
import { readPrizeImages } from "@/lib/raffle-prize-images-server";
import Link from "next/link";
import { z } from "zod";
import { notFound } from "next/navigation";
import { requireCustomer } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { rafflesEnabled } from "@/lib/raffles-server";
import { RaffleParticipation, type RaffleDetail } from "@/components/raffles/raffle-client";
import { RaffleUnavailable } from "@/components/raffles/raffle-shared";
export const metadata = { title: "Participar da rifa" };
export const instant = false;
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireCustomer(); const { id } = await params; const query = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const from = Math.max(0, Math.min(9999, Math.trunc(Number(query.from) || 0)));
  const { data, error } = await (await createClient()).rpc("get_raffle_detail", { p_campaign: id, p_from: from });
  if (data && !error) {
    const photos = await readPrizeImages((data as RaffleDetail).prizes.map(p => p.id));
    data.prizes = (data as RaffleDetail).prizes.map(p => ({ ...p, image_urls: photos.get(p.id) ?? [] }));
  }
  const [buyers,numberStates] = !error && data ? await Promise.all([getRaffleBuyerRanking(id),readRaffleNumberStates(id,(data as RaffleDetail).campaign.total_numbers)]) : [null,null];
  return <div className="grid gap-4"><Link href="/painel/rifas" className="text-sm underline">Voltar às rifas</Link>{error || !data ? <RaffleUnavailable /> : <RaffleParticipation numberStates={numberStates} buyers={buyers} detail={data as RaffleDetail} from={Math.min(from, data.campaign.total_numbers - 1)} resume={query.resume === "raffle"} enabled={await rafflesEnabled()} />}</div>;
}
