import {
  getAppSettings,
  listLots,
  listPlayers,
  listStock,
  requireAdmin,
} from "@/lib/dal";
import { LotsView } from "@/components/admin/lots/lots-view";

export const metadata = { title: "Lotes" };

export default async function LotesPage() {
  await requireAdmin();
  const [{ settings }, lots, players, stock] = await Promise.all([
    getAppSettings(),
    listLots(),
    listPlayers(),
    listStock(),
  ]);

  return (
    <LotsView
      lots={lots}
      players={players}
      stock={stock}
      settings={settings}
    />
  );
}
