import Link from "next/link";
import { ArrowLeft, Trophy } from "lucide-react";
import { LoyaltyRanking } from "@/components/client/loyalty-ranking";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireCustomer } from "@/lib/dal";
import { getCustomerLoyaltyRankingData } from "@/lib/loyalty";

export const metadata = { title: "Meu ranking" };

export default async function ClientRankingPage({ searchParams }: PageProps<"/painel/ranking">) {
  const { customer } = await requireCustomer();
  const params = await searchParams;
  const error = Array.isArray(params.erro) ? params.erro[0] : params.erro;
  const saved = Boolean(params.salvo);
  let data: Awaited<ReturnType<typeof getCustomerLoyaltyRankingData>> | null = null;
  try {
    data = await getCustomerLoyaltyRankingData(customer.id);
  } catch {
    // The customer panel remains usable if the loyalty migration is unavailable.
  }

  return <div className="flex flex-col gap-5">
    <div className="flex flex-col gap-3">
      <Button asChild variant="ghost" size="sm" className="w-fit -ml-2"><Link href="/painel"><ArrowLeft /> Voltar ao painel</Link></Button>
      <div><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.18em] text-ouro-ink"><Trophy className="size-4" /> Fidelidade OCDL</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">Ranking de clientes</h1><p className="text-sm text-muted-foreground">Acompanhe seu elo, veja os líderes e saiba como ganhar pontos.</p></div>
    </div>
    {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</p>}
    {saved && <p role="status" className="rounded-lg border border-ouro/30 bg-amarelo/10 px-4 py-3 text-sm">Sua preferência de participação foi atualizada.</p>}
    {data ? <LoyaltyRanking enabled={data.settings.active && data.settings.ranking_enabled} rankVisible={data.rankVisible} tierLeaders={data.tierLeaders} totalSpent={data.totalSpent} /> : <Card><CardContent className="flex flex-col items-center gap-3 py-10 text-center"><Trophy className="size-9 text-amarelo" /><h2 className="text-xl font-semibold">Estamos preparando o ranking</h2><p className="max-w-md text-sm text-muted-foreground">Ainda não foi possível carregar as faixas de fidelidade. Tente novamente mais tarde; seus lotes e pagamentos seguem disponíveis.</p></CardContent></Card>}
  </div>;
}
