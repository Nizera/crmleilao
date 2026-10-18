import Link from "next/link";
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

export function ClientShipmentsCard({
  shipments,
  total,
}: {
  shipments: Shipment[];
  /** Total real (head-count); a lista pode vir capada em 20. */
  total?: number;
}) {
  const count = total ?? shipments.length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Seus envios</CardTitle>
        <CardDescription>
          {count === 0
            ? "Quando seus lotes pagos forem postados (às terças), o código de rastreio aparece aqui."
            : `${count} ${count === 1 ? "envio" : "envios"} em andamento ou entregues.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {shipments.map((shipment) => (
          <div
            key={shipment.id}
            className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
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
              {(shipment.lots?.length ?? 0) > 0 && (
                <span className="flex flex-wrap gap-1.5">
                  {shipment.lots?.map((lot) => (
                    <Link
                      key={lot.id}
                      href={`/painel/lotes/${lot.code}`}
                      title={`${lot.code} · ${lot.title}`}
                      className="inline-block max-w-44 truncate rounded border px-2 py-0.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    >
                      {lot.code} · {lot.title}
                    </Link>
                  ))}
                </span>
              )}
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
