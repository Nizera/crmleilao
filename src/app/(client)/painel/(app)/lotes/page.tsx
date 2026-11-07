import Link from "next/link";
import { requireCustomer, listLots } from "@/lib/dal";
import { ClientLotsList } from "@/components/client/client-lots-list";
import { formatDateBR } from "@/lib/lots";

export default async function ClientLotsPage({ searchParams }: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  await requireCustomer();
  const allLots = await listLots({ hideExpired: true, images: true, description: true });
  const awaitingShipment = (await searchParams).status === "awaiting_shipment";
  const lots = awaitingShipment ? allLots.filter((lot) => lot.status === "paid") : allLots;

  const latestAuctionDay = lots.reduce<string | null>(
    (acc, lot) => (acc === null || lot.auction_date > acc ? lot.auction_date : acc),
    null,
  );

  return (
    <div className="flex flex-col gap-4">
      {awaitingShipment && <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>Lotes pagos aguardando envio</span><Link href="/painel/lotes" className="underline">Ver todos os lotes</Link></div>}
    <ClientLotsList
      lots={lots}
      subtitle={
        awaitingShipment ? `${lots.length} ${lots.length === 1 ? "lote pago aguardando envio" : "lotes pagos aguardando envio"}.` : lots.length === 0
          ? undefined
          : latestAuctionDay
            ? `${lots.length} ${lots.length === 1 ? "lote arrematado" : "lotes arrematados"} · último leilão em ${formatDateBR(latestAuctionDay)}.`
            : `${lots.length} ${lots.length === 1 ? "lote arrematado" : "lotes arrematados"} por você.`
      }
    />
    </div>
  );
}
