import {
  countCustomerCharges,
  getCustomerFreightState,
  listCustomerCharges,
  listLots,
  requireCustomer,
} from "@/lib/dal";
import { ClientChargesCard } from "@/components/client/charges-card";

export default async function ClientPixPage() {
  const { customer } = await requireCustomer();
  const [lots, charges, chargesTotal, freight] = await Promise.all([
    listLots({ images: true }),
    listCustomerCharges(customer.id),
    countCustomerCharges(customer.id),
    getCustomerFreightState(customer.id),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <ClientChargesCard lots={lots} charges={charges} freight={freight} />
      {chargesTotal > charges.length && (
        <p className="-mt-2 text-center text-xs text-muted-foreground">
          Mostrando as {charges.length} cobranças mais recentes de{" "}
          {chargesTotal}. O restante fica no histórico.
        </p>
      )}
    </div>
  );
}
