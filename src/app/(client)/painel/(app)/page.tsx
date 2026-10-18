import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { listCustomerCharges, listCustomerShipments, listLots, requireCustomer } from "@/lib/dal";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ClientChargesCard } from "@/components/client/charges-card";
import { ClientShipmentsCard } from "@/components/client/shipments-card";
import { ClientLotsList } from "@/components/client/client-lots-list";
import { isChargeActive } from "@/lib/charges";
import { formatDateBR } from "@/lib/lots";

const HISTORY_HREF = "/painel/historico";

function HistoryLink({ href, count }: { href: string; count?: number }) {
  return (
    <Link
      href={href}
      className="flex w-fit items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
    >
      Ver histórico completo{typeof count === "number" ? ` (${count})` : ""}
      <ChevronRight className="size-4" />
    </Link>
  );
}

export default async function ClientHomePage() {
  const { customer } = await requireCustomer();
  const [lots, charges, shipments] = await Promise.all([
    listLots(),
    listCustomerCharges(customer.id),
    listCustomerShipments(customer.id),
  ]);

  // A home é de ação: só o último leilão. O resto fica em /painel/historico.
  const latestAuctionDay = lots.reduce<string | null>(
    (acc, lot) => (acc === null || lot.auction_date > acc ? lot.auction_date : acc),
    null,
  );
  const recentLots = latestAuctionDay
    ? lots.filter((lot) => lot.auction_date === latestAuctionDay)
    : [];
  const olderLotsCount = lots.length - recentLots.length;

  const activeCharge = charges.find((charge) => isChargeActive(charge)) ?? null;
  const homeCharges = charges.slice(0, 5);
  if (activeCharge && !homeCharges.some((charge) => charge.id === activeCharge.id)) {
    homeCharges.push(activeCharge);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Olá{customer.name ? `, ${customer.name.split(" ")[0]}` : ""} 👋
        </h1>
        <p className="text-sm text-muted-foreground">
          Acompanhe seus lotes, pagamentos e envios do leilão.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <ClientChargesCard lots={lots} charges={homeCharges} />
        <HistoryLink href={HISTORY_HREF} count={charges.length} />
      </div>

      <div className="flex flex-col gap-3">
        <Card>
          <CardHeader>
            <CardTitle>Seus lotes</CardTitle>
            <CardDescription>
              {lots.length === 0
                ? "Ainda não há lotes vinculados a este número. Assim que você arrematar um lote, ele aparece aqui com foto, valor e link de pagamento."
                : latestAuctionDay
                  ? `${recentLots.length} ${recentLots.length === 1 ? "lote arrematado" : "lotes arrematados"} no leilão de ${formatDateBR(latestAuctionDay)}.`
                  : `${lots.length} ${lots.length === 1 ? "lote arrematado" : "lotes arrematados"} por você.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recentLots.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Ainda não há lotes vinculados a este número. Assim que você
                arrematar um lote, ele aparece aqui com foto, valor e link de
                pagamento.
              </p>
            ) : (
              <ClientLotsList lots={recentLots} />
            )}
          </CardContent>
        </Card>
        {olderLotsCount > 0 && <HistoryLink href={HISTORY_HREF} count={lots.length} />}
      </div>

      <ClientShipmentsCard shipments={shipments} />
    </div>
  );
}
