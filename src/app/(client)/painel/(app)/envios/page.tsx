import {
  countCustomerShipments,
  listCustomerShipments,
  requireCustomer,
} from "@/lib/dal";
import { ClientShipmentsCard } from "@/components/client/shipments-card";

export default async function ClientShipmentsPage() {
  const { customer } = await requireCustomer();
  const [shipments, total] = await Promise.all([
    listCustomerShipments(customer.id),
    countCustomerShipments(customer.id),
  ]);

  return <ClientShipmentsCard shipments={shipments} total={total} />;
}
