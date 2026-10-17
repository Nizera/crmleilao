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

export default async function ClientHomePage() {
  const { customer } = await requireCustomer();
  const [lots, charges, shipments] = await Promise.all([
    listLots(),
    listCustomerCharges(customer.id),
    listCustomerShipments(customer.id),
  ]);

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

      <ClientChargesCard lots={lots} charges={charges} />

      <Card>
        <CardHeader>
          <CardTitle>Seus lotes</CardTitle>
          <CardDescription>
            {lots.length === 0
              ? "Ainda não há lotes vinculados a este número. Assim que você arrematar um lote, ele aparece aqui com foto, valor e link de pagamento."
              : `${lots.length} ${lots.length === 1 ? "lote arrematado" : "lotes arrematados"} por você.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {lots.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ainda não há lotes vinculados a este número. Assim que você
              arrematar um lote, ele aparece aqui com foto, valor e link de
              pagamento.
            </p>
          ) : (
            <ClientLotsList lots={lots} />
          )}
        </CardContent>
      </Card>

      <ClientShipmentsCard shipments={shipments} />
    </div>
  );
}
