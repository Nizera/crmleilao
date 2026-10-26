import { requireAdmin } from "@/lib/dal";
import { dashboardPeriod } from "@/lib/store-dashboard";
import { getStoreDashboard } from "@/lib/store-dashboard-server";
import { StoreDashboard } from "@/components/admin/loyalty/store-dashboard";
import { LoyaltyAdminShell } from "@/components/admin/loyalty/loyalty-admin-shell";

export const metadata = { title: "Dashboard da loja" };

export default async function StoreDashboardPage({searchParams}:PageProps<"/admin/fidelidade">) {
  const {profile}=await requireAdmin();
  const period=dashboardPeriod(await searchParams);
  const {data,error}=await getStoreDashboard(period);
  return <LoyaltyAdminShell active="resumo" hideHeader>
    {error || !data ? <div role="alert" className="rounded-xl border p-5 text-sm">{error==='migration' ? <>O dashboard precisa da migration <code>0027_store_dashboard.sql</code>, após a 0026. Aplique no Supabase antes de publicar esta versão.</> : 'Não foi possível carregar os indicadores da loja. Tente novamente em instantes.'}</div> : <StoreDashboard data={data} period={period} canEdit={profile.role!=='viewer'}/>}
  </LoyaltyAdminShell>;
}
