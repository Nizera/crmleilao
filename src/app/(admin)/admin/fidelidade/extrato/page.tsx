import { redirect } from 'next/navigation';
import { RetryButton } from '@/components/shared/retry-button';
import { requireAdmin } from '@/lib/dal';
import { historyFilters,pageHref } from '@/lib/loyalty-history';
import { getCoinHistory } from '@/lib/loyalty-history-server';
import { LoyaltyAdminShell } from '@/components/admin/loyalty/loyalty-admin-shell';
import { CoinHistoryView } from '@/components/shared/coin-history';
import { CaracoinsAdjustment } from '@/components/admin/loyalty/caracoins-adjustment';
export const metadata={title:'Extrato de Caracoins'};
export default async function LedgerPage({searchParams}:PageProps<'/admin/fidelidade/extrato'>){
 const {profile}=await requireAdmin();const params=await searchParams;const filters=historyFilters(params);
 const data=await getCoinHistory(filters,true).catch(()=>null);
 if(data&&data.page!==filters.page)redirect(pageHref('/admin/fidelidade/extrato',params,data.page));
 return <LoyaltyAdminShell active="extrato"><div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">{data?<CoinHistoryView key={JSON.stringify(filters)} data={data} filters={filters} params={params} admin/>:<div role="alert" className="rounded-xl border p-5 text-sm">Não foi possível carregar o extrato. Confira a migration 0028 e tente novamente. <RetryButton/></div>}{profile.role!=='viewer'?<CaracoinsAdjustment/>:<p className="text-sm text-muted-foreground">Perfil somente leitura.</p>}</div></LoyaltyAdminShell>;
}
