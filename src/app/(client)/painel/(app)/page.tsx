import Link from "next/link";
import { ArrowRight, Boxes, Coins, Image, Package } from "lucide-react";

import { listCustomerCharges, listCustomerShipments, listLots, requireCustomer } from "@/lib/dal";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LotStatusBadge } from "@/components/admin/lots/lot-status-badge";
import { ClientChargesCard } from "@/components/client/charges-card";
import { ClientShipmentsCard } from "@/components/client/shipments-card";
import { isChargeActive } from "@/lib/charges";
import { formatBRL, formatDateBR } from "@/lib/lots";

export const metadata = { title: "Meu painel" };

const roadmap = [
  {
    phase: "Fase 1",
    title: "Seus lotes arrematados",
    icon: Package,
    description:
      "Cada lote com foto, valor e data de envio — tudo o que você arrematou em um lugar só.",
  },
  {
    phase: "Fase 3",
    title: "Pagamento em 1 clique",
    icon: Coins,
    description:
      "Selecione os lotes pendentes e gere um único Pix com o valor somado.",
  },
  {
    phase: "Fase 4",
    title: "Envios e rastreio",
    icon: Boxes,
    description:
      "Acompanhe os pacotes postados às terças com o código de rastreio.",
  },
  {
    phase: "Fase 3",
    title: "Fotos dos lotes",
    icon: Image,
    description:
      "As imagens enviadas no cadastro ficam disponíveis aqui no seu painel.",
  },
];

export default async function ClientHomePage() {
  const { customer } = await requireCustomer();
  const [lots, charges, shipments] = await Promise.all([
    listLots(),
    listCustomerCharges(customer.id),
    listCustomerShipments(customer.id),
  ]);

  const hasActiveCharge = charges.some((charge) => isChargeActive(charge));
  const pendingLots = lots.filter((lot) => lot.status === "pending_payment");
  const canGenerate = !hasActiveCharge && pendingLots.length > 0;

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

      <Card>
        <CardHeader>
          <CardTitle>Seus lotes</CardTitle>
          <CardDescription>
            {lots.length === 0
              ? "Ainda não há lotes vinculados a este número. Assim que você arrematar um lote, ele aparece aqui com foto, valor e link de pagamento."
              : `${lots.length} ${lots.length === 1 ? "lote arrematado" : "lotes arrematados"} por você.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {lots.map((lot) => (
            <Link
              key={lot.id}
              href={`/painel/lotes/${lot.code}`}
              className="flex items-center justify-between gap-3 rounded-md border p-3 transition hover:bg-muted/50"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{lot.title}</span>
                <span className="text-xs text-muted-foreground">
                  {formatBRL(lot.arremate_value)} · envio{" "}
                  {formatDateBR(lot.shipping_date)}
                </span>
              </span>
              <LotStatusBadge status={lot.status} />
            </Link>
          ))}
          {lots.length === 0 && (
            <Link
              href="/"
              className="inline-flex w-fit items-center gap-1 text-sm underline underline-offset-4 hover:text-foreground"
            >
              Voltar para o início
              <ArrowRight className="size-3.5" />
            </Link>
          )}
        </CardContent>
      </Card>

      <ClientChargesCard charges={charges} canGenerate={canGenerate} />

      <ClientShipmentsCard shipments={shipments} />

      <div className="grid gap-4 sm:grid-cols-2">
        {roadmap.map((item) => (
          <Card key={item.title}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <span className="flex size-9 items-center justify-center rounded-md border bg-muted">
                  <item.icon className="size-4" />
                </span>
                <Badge variant="secondary">{item.phase}</Badge>
              </div>
              <CardTitle className="text-base">{item.title}</CardTitle>
              <CardDescription>{item.description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
