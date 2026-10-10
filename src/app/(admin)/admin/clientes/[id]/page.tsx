import { notFound } from "next/navigation";

import { CustomerDetailView } from "@/components/admin/customers/customer-detail";
import {
  getCustomer,
  getCustomerInvite,
  listCustomerLots,
  requireAdmin,
} from "@/lib/dal";

export const metadata = { title: "Cliente" };

export default async function ClienteDetalhePage({
  params,
}: PageProps<"/admin/clientes/[id]">) {
  await requireAdmin();

  const { id } = await params;
  const customer = await getCustomer(id);
  if (!customer) notFound();

  const lots = await listCustomerLots(id);
  const invite = await getCustomerInvite(id);

  return <CustomerDetailView customer={customer} lots={lots} invite={invite} />;
}
