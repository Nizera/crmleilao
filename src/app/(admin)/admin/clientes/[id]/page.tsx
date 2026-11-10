import { notFound } from "next/navigation";

import { CustomerDetailView } from "@/components/admin/customers/customer-detail";
import {createClient} from "@/lib/supabase/server";
import {
  getCustomer,
  getCustomerInvite,
  getCustomerLotStats,
  getCustomerNextShipment,
  getCustomerSpendingSummary,
  listCustomerLotsPage,
  requireAdmin,
} from "@/lib/dal";

export const metadata = { title: "Cliente" };

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

export default async function ClienteDetalhePage({
  params,
  searchParams,
}: PageProps<"/admin/clientes/[id]">) {
  await requireAdmin();

  const { id } = await params;
  const customer = await getCustomer(id);
  if (!customer) notFound();
  const db=await createClient();
  const {data:accessEvents,error:eventsError}=await db.from("customer_access_events").select("id,kind,reason,created_at").eq("customer_id",id).order("created_at",{ascending:false}).limit(20);
  if(eventsError)throw new Error("Não foi possível carregar o histórico de acesso.");

  const sp = await searchParams;
  const page = Math.max(1, Number(first(sp.lp)) || 1);

  const [lotsPage, stats, invite, spending, nextShipment] = await Promise.all([
    listCustomerLotsPage(id, page),
    getCustomerLotStats(id),
    getCustomerInvite(id),
    getCustomerSpendingSummary(id),
    getCustomerNextShipment(id),
  ]);

  return (
    <CustomerDetailView
      customer={customer}
      accessEvents={accessEvents??[]}
      lots={lotsPage.rows}
      total={lotsPage.total}
      page={lotsPage.page}
      pageSize={lotsPage.pageSize}
      stats={stats}
      invite={invite}
      spending={spending}
      nextShipment={nextShipment}
    />
  );
}
