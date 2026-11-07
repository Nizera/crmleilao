import Link from "next/link";
import { z } from "zod";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { redirectCommerceMember } from "@/lib/public-commerce-server";
import { RaffleParticipation, type RaffleDetail } from "@/components/raffles/raffle-client";
export const metadata={title:"Participar da rifa · Os Caras das Legends"};export const instant=false;
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const {id}=await params;const query=await searchParams;if(!z.uuid().safeParse(id).success)notFound();
 const from=Math.max(0,Math.min(9999,Math.trunc(Number(query.from)||0)));
 await redirectCommerceMember(`/painel/rifas/${id}?from=${from}`);
 const {data,error}=await(await createClient()).rpc('get_public_raffle_detail',{p_campaign:id,p_from:from});
 if(error?.code==='P0001'||!data&&!error)notFound();
 return <div className="raffle-client grid gap-4"><Link className="text-sm underline" href="/rifas">Voltar às rifas</Link>{error?<p role="alert">Não foi possível carregar esta campanha. Tente novamente.</p>:<RaffleParticipation detail={data as RaffleDetail} from={from} enabled guest/>}</div>;
}
