import { CustomersView } from "@/components/admin/customers/customers-view";
import { listCustomersPage, requireAdmin } from "@/lib/dal";
import { CUSTOMER_ISSUES, type CustomerIssue } from "@/lib/admin-list-filters";
import { parseLotRange } from "@/lib/lot-filters";

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
  const rawIssue = first(params.issue);
  const issue = Object.hasOwn(CUSTOMER_ISSUES, rawIssue) ? rawIssue as CustomerIssue : "all";
  const range = parseLotRange(first(params.from), first(params.to));

  const data = range.error ? { rows: [], total: 0, page: 1, pageSize: 10 } : await listCustomersPage({ q, page, issue, lotStartUtc: range.startUtc, lotEndUtc: range.endUtc });

  return <CustomersView key={`${q}/${issue}/${range.from}/${range.to}/${range.error}`} {...data} q={q} issue={issue} dateFrom={range.from} dateTo={range.to} filterError={range.error} />;
}
