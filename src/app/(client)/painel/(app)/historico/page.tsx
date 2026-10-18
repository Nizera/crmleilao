import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { ClientHistoryView } from "@/components/client/history-view";
import { Button } from "@/components/ui/button";
import {
  listCustomerCharges,
  listCustomerLots,
  listCustomerShipments,
  requireCustomer,
} from "@/lib/dal";

export const metadata = { title: "Histórico" };

export default async function ClientHistoryPage() {
  const { customer } = await requireCustomer();

  const [lots, charges, shipments] = await Promise.all([
    listCustomerLots(customer.id),
    listCustomerCharges(customer.id, 200),
    listCustomerShipments(customer.id, 200),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Button asChild variant="ghost" size="sm" className="w-fit -ml-2">
          <Link href="/painel">
            <ChevronLeft />
            Voltar ao painel
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Histórico</h1>
          <p className="text-sm text-muted-foreground">
            Todos os seus lotes, pagamentos e envios, organizados por leilão.
          </p>
        </div>
      </div>

      <ClientHistoryView lots={lots} charges={charges} shipments={shipments} />
    </div>
  );
}
