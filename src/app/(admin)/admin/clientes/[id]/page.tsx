import { notFound } from "next/navigation";

import { CustomerDetailView } from "@/components/admin/customers/customer-detail";
import { getCustomer, listCustomerLots, requireAdmin } from "@/lib/dal";

export const metadata = { title: "Cliente" };

export default async function ClienteDetalhePage({
  params,
}: PageProps<"/admin/clientes/[id]">) {
  await requireAdmin();

  const { id } = await params;
  const customer = await getCustomer(id);
  if (!customer) notFound();

  const lots = await listCustomerLots(id);

  return <CustomerDetailView customer={customer} lots={lots} />;
}
