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
import { parseLotRange } from "@/lib/lot-filters";
import { isIsoDay } from "@/lib/dates";
import { normalizeLotSort } from "@/lib/lot-sort";

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
  const range = parseLotRange(first(params.from), first(params.to));
  const rawShipping = first(params.shipping);
  const shippingDate = isIsoDay(rawShipping) ? rawShipping : "";
  const sort = normalizeLotSort(first(params.sort));

  const [{ settings }, lotsPage, players, stock] = await Promise.all([
    getAppSettings(),
    // Lista magra paginada: itens/fotos/descrição ficam no detalhe
    // (getLotDetailAction); qtyByLot cobre só as linhas da página.
    range.error ? Promise.resolve({ rows: [], total: 0, page: 1, pageSize: 25 }) : listLotsPage({ q, status: status as LotStatus | "all", page, notes: true, startUtc: range.startUtc, endUtc: range.endUtc, shippingDate, sort }),
    listPlayers(),
    listStock(),
  ]);
  const qtyByLot = await listLotItemQty(lotsPage.rows.map((lot) => lot.id));

  return (
    <LotsView
      key={`${q}/${status}/${range.from}/${range.to}/${range.error}/${shippingDate}/${sort}`}
      lots={lotsPage.rows}
      total={lotsPage.total}
      page={lotsPage.page}
      pageSize={lotsPage.pageSize}
      q={q}
      status={status}
      dateFrom={range.from}
      dateTo={range.to}
      filterError={range.error}
      shippingDate={shippingDate}
      sort={sort}
      players={players}
      stock={stock}
      settings={settings}
      qtyByLot={qtyByLot}
    />
  );
}
