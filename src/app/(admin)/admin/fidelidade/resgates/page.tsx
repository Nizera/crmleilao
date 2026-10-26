import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/dal";
import { getAdminOrderHistory } from "@/lib/order-history-server";
import { orderHistoryFilters, orderHistoryHref } from "@/lib/order-history";
import { AdminStoreOrders } from "@/components/admin/loyalty/store-orders";
import { LoyaltyAdminShell } from "@/components/admin/loyalty/loyalty-admin-shell";

export const metadata = { title: "Pedidos da loja" };

export default async function LoyaltyOrdersPage({ searchParams }: PageProps<"/admin/fidelidade/resgates">) {
  const { profile } = await requireAdmin();
  const params = await searchParams;
  const filters = orderHistoryFilters(params);
  const { data,error } = await getAdminOrderHistory(filters);
  if (data && data.page !== filters.page) redirect(orderHistoryHref(filters,{page:data.page}));
  const message = Array.isArray(params.erro) ? params.erro[0] : params.erro;
  return <LoyaltyAdminShell active="resgates" error={message} saved={Boolean(params.salvo)}>
    {error || !data ? <div role="alert" className="rounded-xl border p-5 text-sm">
      {error === "migration" ? <>A nova lista de pedidos precisa da migration <code>0026_admin_order_history.sql</code>. Aplique o arquivo no Supabase antes de publicar esta versão.</> : "Não foi possível carregar os pedidos. Tente novamente em instantes."}
    </div> : <AdminStoreOrders data={data} filters={filters} canEdit={profile.role !== "viewer"} />}
  </LoyaltyAdminShell>;
}
