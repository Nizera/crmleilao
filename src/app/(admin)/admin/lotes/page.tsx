import {
  getAppSettings,
  listLotItemQty,
  listLots,
  listPlayers,
  listStock,
  requireAdmin,
} from "@/lib/dal";
import { LotsView } from "@/components/admin/lots/lots-view";

export const metadata = { title: "Lotes" };

export default async function LotesPage() {
  await requireAdmin();
  const [{ settings }, lots, players, stock, qtyByLot] = await Promise.all([
    getAppSettings(),
    // Lista magra: itens/fotos/descrição ficam no detalhe (getLotDetailAction),
    // exceto o total de unidades, que vem em `qtyByLot`.
    listLots({ notes: true }),
    listPlayers(),
    listStock(),
    listLotItemQty(),
  ]);

  return (
    <LotsView
      lots={lots}
      players={players}
      stock={stock}
      settings={settings}
      qtyByLot={qtyByLot}
    />
  );
}
