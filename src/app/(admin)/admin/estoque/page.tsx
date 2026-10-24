import { listLotsInCustomerBoxes, listMovements, listStock, requireAdmin } from "@/lib/dal";
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
  const boxesPage = Math.max(1, Number(first(params.bp)) || 1);
  const tab = ["movimentos", "caixas"].includes(first(params.t)) ? first(params.t) : "saldo";

  const [stock, movements, movedLots] = await Promise.all([
    listStock(),
    listMovements({ page }),
    tab === "caixas"
      ? listLotsInCustomerBoxes(boxesPage)
      : Promise.resolve({ rows: [], total: 0, page: 1, pageSize: 25 }),
  ]);

  return <StockView stock={stock} movements={movements} movedLots={movedLots} tab={tab} />;
}
