import { listMovements, listStock, requireAdmin } from "@/lib/dal";
import { StockView } from "@/components/admin/stock/stock-view";

export const metadata = { title: "Estoque" };

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

export default async function EstoquePage({
  searchParams,
}: PageProps<"/admin/estoque">) {
  await requireAdmin();

  const params = await searchParams;
  const page = Math.max(1, Number(first(params.p)) || 1);
  const tab = first(params.t) === "movimentos" ? "movimentos" : "saldo";

  const [stock, movements] = await Promise.all([
    listStock(),
    listMovements({ page }),
  ]);

  return <StockView stock={stock} movements={movements} tab={tab} />;
}
