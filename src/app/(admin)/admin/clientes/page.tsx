import { CustomersView } from "@/components/admin/customers/customers-view";
import { listCustomersPage, requireAdmin } from "@/lib/dal";

export const metadata = { title: "Clientes" };

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

export default async function ClientesPage({
  searchParams,
}: PageProps<"/admin/clientes">) {
  await requireAdmin();

  const params = await searchParams;
  const q = first(params.q);
  const page = Math.max(1, Number(first(params.p)) || 1);

  const data = await listCustomersPage({ q, page });

  return <CustomersView {...data} q={q} />;
}
