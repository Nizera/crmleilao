import { LotsView } from "@/components/admin/lots/lots-view";
import {
  getAppSettings,
  listLotItemQty,
  listLotsPage,
  listPlayers,
  listStock,
  requireAdmin,
} from "@/lib/dal";
import { LOT_STATUSES, type LotStatus } from "@/lib/lots";

export const metadata = { title: "Lotes" };

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

const VALID_STATUS: string[] = ["all", ...LOT_STATUSES];

export default async function LotesPage({
  searchParams,
}: PageProps<"/admin/lotes">) {
  await requireAdmin();

  const params = await searchParams;
  const q = first(params.q);
  const rawStatus = first(params.status) || "all";
  const status = VALID_STATUS.includes(rawStatus) ? rawStatus : "all";
  const page = Math.max(1, Number(first(params.p)) || 1);

  const [{ settings }, lotsPage, players, stock] = await Promise.all([
    getAppSettings(),
    // Lista magra paginada: itens/fotos/descrição ficam no detalhe
    // (getLotDetailAction); qtyByLot cobre só as linhas da página.
    listLotsPage({ q, status: status as LotStatus | "all", page, notes: true }),
    listPlayers(),
    listStock(),
  ]);
  const qtyByLot = await listLotItemQty(lotsPage.rows.map((lot) => lot.id));

  return (
    <LotsView
      lots={lotsPage.rows}
      total={lotsPage.total}
      page={lotsPage.page}
      pageSize={lotsPage.pageSize}
      q={q}
      status={status}
      players={players}
      stock={stock}
      settings={settings}
      qtyByLot={qtyByLot}
    />
  );
}
