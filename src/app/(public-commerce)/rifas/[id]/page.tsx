import type { Metadata } from "next";
import { rafflePhotos } from "@/lib/raffle-photos";
import { raffleMoney } from "@/lib/raffles";
import Link from "next/link";
import { z } from "zod";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { redirectCommerceMember } from "@/lib/public-commerce-server";
import { RaffleParticipation, type RaffleDetail } from "@/components/raffles/raffle-client";
export const instant=false;
export async function generateMetadata({params}:{params:Promise<{id:string}>}):Promise<Metadata>{
 const {id}=await params;
 if(!z.uuid().safeParse(id).success)return {title:"Rifa não encontrada"};
 // Usa somente a consulta pública: nenhum dado de comprador ou cota oculta.
 const {data,error}=await(await createClient()).rpc("get_public_raffle_detail",{p_campaign:id,p_from:0});
 if(error||!data)return {title:"Rifas dos Caras"};
 const campaign=(data as RaffleDetail).campaign;
 const title=campaign.title;
 const description=`${raffleMoney(campaign.unit_price)} por cota. Confira os prêmios e participe da rifa de Os Caras das Legends.`;
 const url=`https://www.oscarasdaslegends.com.br/rifas/${id}`;
 const images=rafflePhotos(campaign).slice(0,1).map(url=>({url,alt:title}));
 return {title,description,alternates:{canonical:url},openGraph:{type:"website",locale:"pt_BR",siteName:"Os Caras das Legends",url,title,description,images},twitter:{card:images.length?"summary_large_image":"summary",title,description,images:images.map(image=>image.url)}};
}
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const {id}=await params;const query=await searchParams;if(!z.uuid().safeParse(id).success)notFound();
 const from=Math.max(0,Math.min(9999,Math.trunc(Number(query.from)||0)));
 await redirectCommerceMember(`/painel/rifas/${id}?from=${from}`);
 const {data,error}=await(await createClient()).rpc('get_public_raffle_detail',{p_campaign:id,p_from:from});
 if(error?.code==='P0001'||!data&&!error)notFound();
 return <div className="raffle-client grid gap-4"><Link className="text-sm underline" href="/rifas">Voltar às rifas</Link>{error?<p role="alert">Não foi possível carregar esta campanha. Tente novamente.</p>:<RaffleParticipation detail={data as RaffleDetail} from={from} enabled guest/>}</div>;
}
