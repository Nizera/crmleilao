import { ExternalLink, Truck } from "lucide-react";

import { ShipmentStatusBadge } from "@/components/admin/shipments/shipment-status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Shipment } from "@/lib/shipments";
import { formatDateBR } from "@/lib/lots";

export function ClientShipmentsCard({ shipments }: { shipments: Shipment[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Seus envios</CardTitle>
        <CardDescription>
          {shipments.length === 0
            ? "Quando seus lotes pagos forem postados (às terças), o código de rastreio aparece aqui."
            : `${shipments.length} ${shipments.length === 1 ? "envio" : "envios"} em andamento ou entregues.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {shipments.map((shipment) => (
          <div
            key={shipment.id}
            className="flex items-center justify-between gap-3 rounded-md border p-3"
          >
            <span className="flex min-w-0 flex-col">
              <span className="flex items-center gap-2 truncate font-medium">
                <Truck className="size-4 shrink-0 text-muted-foreground" />
                {shipment.carrier ?? shipment.service_name ?? "Envio"} ·{" "}
                {shipment.lots?.length ?? 0}
                {(shipment.lots?.length ?? 0) === 1 ? " lote" : " lotes"}
              </span>
              <span className="text-xs text-muted-foreground">
                envio previsto {formatDateBR(shipment.batch_date)}
                {shipment.tracking_code ? ` · ${shipment.tracking_code}` : ""}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <ShipmentStatusBadge status={shipment.status} />
              {shipment.tracking_url && (
                <a
                  href={shipment.tracking_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Rastrear o envio ${shipment.code}`}
                  className="text-muted-foreground transition hover:text-foreground"
                >
                  <ExternalLink className="size-4" />
                </a>
              )}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
