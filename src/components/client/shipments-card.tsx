import Link from "next/link";
import { Check, ExternalLink, Truck } from "lucide-react";

import { ShipmentStatusBadge } from "@/components/admin/shipments/shipment-status-badge";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import type { Shipment, ShipmentStatus } from "@/lib/shipments";
import { formatDateBR } from "@/lib/lots";

const STEPS = ["Separação", "Etiqueta", "Postagem", "Entregue"] as const;

/** Quantas etapas do stepper já estão concluídas para cada status. */
function stepsDone(status: ShipmentStatus): number | null {
  switch (status) {
    // "Etiqueta pendente": separação concluída, etiqueta em aberto.
    case "pending":
      return 1;
    case "released":
      return 2;
    case "posted":
      return 3;
    case "delivered":
      return 4;
    case "cancelled":
      return null;
  }
}

function Stepper({ status }: { status: ShipmentStatus }) {
  const done = stepsDone(status);
  if (done == null) return null;
  const allDone = done === STEPS.length;

  return (
    <div className="mt-3 flex flex-col gap-2 border-t pt-3">
      <div className="flex items-center justify-between text-[10px] font-bold uppercase">
        {STEPS.map((step, index) => {
          const isDone = index < done;
          const isCurrent = !allDone && index === done;

          return (
            <span
              key={step}
              className={cn(
                "flex items-center gap-0.5",
                isDone
                  ? "text-ouro-ink"
                  : isCurrent
                    ? "text-foreground"
                    : "text-muted-foreground",
              )}
            >
              {isDone ? (
                <Check className="size-3" />
              ) : isCurrent ? (
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amarelo opacity-75" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-amarelo" />
                </span>
              ) : null}
              {step}
            </span>
          );
        })}
      </div>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
        {STEPS.map((step, index) => (
          <span
            key={step}
            className={cn(
              "h-full flex-1",
              index < done
                ? "bg-ouro"
                : index === done
                  ? "bg-amarelo"
                  : "bg-transparent",
            )}
          />
        ))}
      </div>
    </div>
  );
}

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
    <section className="flex flex-col gap-2">
      <div className="flex items-end justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <h2 className="text-base font-bold tracking-tight">Seus Envios</h2>
          <span className="truncate text-xs text-muted-foreground">
            {count === 0
              ? "Quando seus lotes pagos forem postados (às terças), o código de rastreio aparece aqui."
              : `${count} ${count === 1 ? "envio" : "envios"} em andamento ou entregues.`}
          </span>
        </div>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Truck className="size-5" />
        </span>
      </div>

      {count === 0 && (
        <EmptyState
          image="/brand/empty-shipments.png"
          title="Nenhum envio ainda"
          description="Assim que seus lotes pagos forem postados (às terças), o rastreio aparece aqui."
        />
      )}

      <div className="flex flex-col gap-2">
        {shipments.map((shipment) => (
          <div
            key={shipment.id}
            className="flex flex-col rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amarelo/15 text-ouro-ink">
                  <Truck className="size-[18px]" />
                </span>
                <div className="min-w-0">
                  <span className="block truncate text-sm font-bold">
                    {shipment.carrier ?? shipment.service_name ?? "Envio"} •{" "}
                    {shipment.lots?.length ?? 0}
                    {(shipment.lots?.length ?? 0) === 1 ? " lote" : " lotes"}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {shipment.tracking_code ? (
                      <span className="font-mono">{shipment.tracking_code}</span>
                    ) : (
                      <>Previsão: {formatDateBR(shipment.batch_date)}</>
                    )}
                  </span>
                </div>
              </div>
              <ShipmentStatusBadge status={shipment.status} />
            </div>

            {(shipment.lots?.length ?? 0) > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {shipment.lots?.map((lot) => (
                  <Link
                    key={lot.id}
                    href={`/painel/lotes/${lot.code}`}
                    title={`${lot.code} · ${lot.title}`}
                    className="rounded bg-muted px-2 py-0.5 font-mono text-[10px] tracking-wide text-muted-foreground transition hover:text-foreground"
                  >
                    {lot.code} • {lot.title}
                  </Link>
                ))}
              </div>
            )}

            <Stepper status={shipment.status} />

            {(shipment.tracking_url || shipment.tracking_code) && (
              <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
                <span className="truncate text-[11px] text-muted-foreground">
                  Envio previsto {formatDateBR(shipment.batch_date)}
                </span>
                {shipment.tracking_url && (
                  <a
                    href={shipment.tracking_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Rastrear o envio ${shipment.code}`}
                    className="flex items-center gap-0.5 text-[11px] font-bold uppercase tracking-wider text-ouro-ink transition hover:text-foreground"
                  >
                    Rastrear
                    <ExternalLink className="size-3.5" />
                  </a>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
