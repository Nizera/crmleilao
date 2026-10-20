import { requireCustomer, listLots } from "@/lib/dal";
import { ClientLotsList } from "@/components/client/client-lots-list";
import { formatDateBR } from "@/lib/lots";

export default async function ClientLotsPage() {
  await requireCustomer();
  const lots = await listLots({ images: true });

  const latestAuctionDay = lots.reduce<string | null>(
    (acc, lot) => (acc === null || lot.auction_date > acc ? lot.auction_date : acc),
    null,
  );

  return (
    <ClientLotsList
      lots={lots}
      subtitle={
        lots.length === 0
          ? undefined
          : latestAuctionDay
            ? `${lots.length} ${lots.length === 1 ? "lote arrematado" : "lotes arrematados"} · último leilão em ${formatDateBR(latestAuctionDay)}.`
            : `${lots.length} ${lots.length === 1 ? "lote arrematado" : "lotes arrematados"} por você.`
      }
    />
  );
}
