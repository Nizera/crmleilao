import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirectCommerceMember } from "@/lib/public-commerce-server";
import { RaffleCard, RaffleUnavailable } from "@/components/raffles/raffle-shared";
import { HistoryPagination } from "@/components/shared/history-pagination";
import { historyFilters, pageHref } from "@/lib/loyalty-history";
import type { Raffle } from "@/lib/raffles";
import { commerceLoginHref } from "@/lib/commerce-access";
export const metadata={title:"Rifas dos Caras · Campanhas"};export const instant=false;
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const params=await searchParams;const filters=historyFilters(params);await redirectCommerceMember(pageHref('/painel/rifas',params,filters.page));
 const {data,error}=await(await createClient()).rpc('get_public_raffles',{p_query:filters.q,p_page:filters.page,p_closed:params.state==='closed'});
 const items=(data?.items??[]) as Raffle[];
 return <div className="raffle-client grid gap-5"><header className="rf-heading"><div><h1>Rifas dos Caras</h1><p>Conheça os prêmios e escolha suas cotas. Entre para concluir a reserva.</p></div><Link className="rf-button" href={commerceLoginHref('/painel/rifas?tab=orders')}>Minhas cotas e prêmios</Link></header><form action="/rifas" className="rf-search"><input aria-label="Buscar campanha" name="q" maxLength={100} defaultValue={filters.q} placeholder="Buscar campanha"/><button type="submit">Buscar</button></form><div className="flex gap-3 text-sm"><Link href="/rifas">Em andamento</Link><Link href="/rifas?state=closed">Encerradas</Link></div>{error?<RaffleUnavailable/>:items.length?<div className="grid items-start gap-5 sm:grid-cols-2 lg:grid-cols-3">{items.map(c=><RaffleCard key={c.id} campaign={c} publicView/>)}</div>:<p className="rf-panel text-sm">Nenhuma campanha encontrada.</p>}{!error&&<HistoryPagination path="/rifas" params={params} data={{page:filters.page,pages:Math.max(1,Math.ceil(Number(data?.total??0)/10)),size:10,total:Number(data?.total??0)}}/>}</div>;
}
