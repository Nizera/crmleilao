import {
  countCustomerShipments,
  listCustomerShipments,
  requireCustomer,
  getCustomerFreightState,
} from "@/lib/dal";
import { ClientShipmentsCard } from "@/components/client/shipments-card";
import Link from "next/link";
import { formatBRL } from "@/lib/lots";

export default async function ClientShipmentsPage() {
  const { customer } = await requireCustomer();
  const [shipments, total, freight] = await Promise.all([
    listCustomerShipments(customer.id),
    countCustomerShipments(customer.id),
    getCustomerFreightState(customer.id),
  ]);

  return <div className="grid min-w-0 gap-4">
    {freight.status!=='none' && <section className="min-w-0 rounded-xl border bg-card p-4 text-sm [overflow-wrap:anywhere]">
      <h2 className="font-semibold">Frete do envio acumulado</h2>
      <p className="mt-1 text-muted-foreground">{freight.status==='paid'?'Frete pago, disponível para seu próximo envio.':freight.status==='awaiting'?`Incluído no Pix ${freight.chargeCode ?? ''}, aguardando confirmação.`:`${formatBRL(freight.amount)} pendente. Uma única taxa pelos lotes acumulados, mesmo de semanas diferentes.`}</p>
      {freight.status!=='paid' && <Link href="/painel/pix" className="mt-2 inline-block font-medium underline">Ver pagamento</Link>}
    </section>}
    <ClientShipmentsCard shipments={shipments} total={total} />
  </div>;
}
