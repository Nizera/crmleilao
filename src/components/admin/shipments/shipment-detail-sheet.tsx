"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Ban,
  ExternalLink,
  Loader2,
  Printer,
  RefreshCw,
  Wallet,
  MessageCircle,
} from "lucide-react";
import { toast } from "sonner";

import {
  cancelShipmentAction,
  getShippingNoticeAction,
  logShippingNotice,
  payShipmentAction,
  printShipmentAction,
  syncShipmentAction,
} from "@/app/actions/shipments";
import { ShipmentStatusBadge } from "@/components/admin/shipments/shipment-status-badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatPhoneBR } from "@/lib/customers";
import { formatDateBR, formatBRL } from "@/lib/lots";
import {
  canCancelShipment,
  canPayShipment,
  type Shipment,
} from "@/lib/shipments";

type Props = {
  shipment: Shipment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: (shipment: Shipment) => void;
};

const fmtDateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

export function ShipmentDetailSheet({
  shipment,
  open,
  onOpenChange,
  onUpdate,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState<string | null>(null);

  const run = (key: string, task: () => Promise<{ ok: boolean; error?: string; data?: Shipment }>) => {
    setPending(key);
    startTransition(async () => {
      try {
        const result = await task();
        if (!result.ok) {
          toast.error(result.error ?? "Falha na operação.");
          return;
        }
        if (result.data) {
          onUpdate(result.data);
          toast.success("Envio atualizado.");
        }
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Erro inesperado.");
      } finally {
        setPending(null);
      }
    });
  };

  const pay = (target: Shipment) => {
    const label = target.price != null ? ` (${formatBRL(target.price)})` : "";
    if (!window.confirm(`Pagar a etiqueta de ${target.code}${label} com o saldo da carteira?`)) return;
    run(target.id, async () => {
      const result = await payShipmentAction(target.id);
      return result.ok
        ? { ok: true, data: result.data }
        : { ok: false, error: result.error };
    });
  };

  const sync = (target: Shipment) => {
    run(target.id, async () => {
      const result = await syncShipmentAction(target.id);
      return result.ok
        ? { ok: true, data: result.data }
        : { ok: false, error: result.error };
    });
  };

  const cancel = (target: Shipment) => {
    if (!window.confirm(`Cancelar o envio ${target.code}? A etiqueta é estornada e os lotes voltam a Pago.`)) return;
    run(target.id, async () => {
      const result = await cancelShipmentAction(target.id);
      return result.ok
        ? { ok: true, data: result.data }
        : { ok: false, error: result.error };
    });
  };

  const print = (target: Shipment) => {
    run(target.id, async () => {
      const result = await printShipmentAction(target.id);
      if (!result.ok) return { ok: false, error: result.error };
      window.open(result.data.url, "_blank", "noopener");
      return { ok: true };
    });
  };

  const notify = (target: Shipment) => {
    run(target.id, async () => {
      const notice = await getShippingNoticeAction(target.id);
      if (!notice.ok) return { ok: false, error: notice.error };

      const logged = await logShippingNotice(
        target.id,
        notice.data.text,
        notice.data.link,
      );
      window.open(notice.data.link, "_blank", "noopener");
      if (!logged.ok) {
        toast.info(`Aviso aberto, mas o registro falhou: ${logged.error}`);
      }
      return { ok: true };
    });
  };

  if (!shipment) return null;

  const address = shipment.address;
  const volume = shipment.volume;
  const finalPrice =
    shipment.price != null
      ? Number(shipment.price) - Number(shipment.discount ?? 0)
      : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg"
      >
        <SheetHeader className="border-b px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <SheetTitle className="font-mono">{shipment.code}</SheetTitle>
            <ShipmentStatusBadge status={shipment.status} />
          </div>
          <SheetDescription>
            {shipment.customer ? (
              <Link
                href={`/admin/clientes/${shipment.customer_id}`}
                className="hover:underline"
              >
                {shipment.customer.name ?? "Sem nome"} ·{" "}
                {formatPhoneBR(shipment.customer.phone_e164)}
              </Link>
            ) : (
              "Cliente não encontrado"
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-6 py-5">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <Field label="Transportadora" value={shipment.carrier ?? shipment.service_name ?? "—"} />
            <Field label="Envio (terça)" value={formatDateBR(shipment.batch_date)} />
            <Field label="Valor" value={finalPrice != null ? formatBRL(finalPrice) : "—"} />
            <Field
              label="Desconto"
              value={
                shipment.discount != null && Number(shipment.discount) > 0
                  ? formatBRL(shipment.discount)
                  : "—"
              }
            />
            <Field label="Seguro" value={formatBRL(shipment.insurance_value)} />
            <Field
              label="Prazo"
              value={
                shipment.delivery_time
                  ? `${shipment.delivery_time} dia${shipment.delivery_time === 1 ? "" : "s"}`
                  : "—"
              }
            />
            <Field
              label="Etiqueta paga em"
              value={fmtDateTime(shipment.paid_at)}
            />
            <Field label="Postado em" value={fmtDateTime(shipment.posted_at)} />
            <Field label="Entregue em" value={fmtDateTime(shipment.delivered_at)} />
            <Field label="Cancelado em" value={fmtDateTime(shipment.cancelled_at)} />
          </dl>

          {volume && (
            <div className="rounded-md border px-3 py-2.5 text-sm">
              <p className="text-xs font-medium text-muted-foreground">Caixa</p>
              <p>
                {volume.height} × {volume.width} × {volume.length} cm ·{" "}
                {volume.weight} kg
              </p>
            </div>
          )}

          {address && (
            <div className="rounded-md border px-3 py-2.5 text-sm">
              <p className="text-xs font-medium text-muted-foreground">
                Destinatário (snapshot)
              </p>
              <p className="font-medium">{address.name}</p>
              <p className="text-muted-foreground">
                {address.address}, {address.number ?? "S/N"}
                {address.complement ? ` — ${address.complement}` : ""}
              </p>
              <p className="text-muted-foreground">
                {address.district} · {address.city}/{address.state_abbr} · CEP{" "}
                {address.postal_code}
              </p>
              {address.phone && (
                <p className="text-muted-foreground">
                  {address.phone}
                  {address.document ? ` · ${address.document}` : ""}
                </p>
              )}
            </div>
          )}

          <div className="rounded-md border px-3 py-2.5 text-sm">
            <p className="text-xs font-medium text-muted-foreground">Rastreio</p>
            {shipment.tracking_code ? (
              <div className="mt-0.5 flex items-center justify-between gap-2">
                <span className="font-mono">{shipment.tracking_code}</span>
                {shipment.tracking_url && (
                  <a
                    href={shipment.tracking_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    Rastrear
                    <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
            ) : (
              <p className="mt-0.5 text-muted-foreground">
                Sem código ainda — sincronize ou aguarde o webhook.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">
              Lotes ({shipment.lots?.length ?? 0})
            </p>
            <ul className="flex flex-col divide-y rounded-md border">
              {(shipment.lots ?? []).map((lot) => (
                <li
                  key={lot.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <Link
                    href={`/admin/lotes?code=${lot.code}`}
                    className="truncate font-medium hover:underline"
                  >
                    {lot.code} · {lot.title}
                  </Link>
                </li>
              ))}
              {(shipment.lots ?? []).length === 0 && (
                <li className="px-3 py-2 text-sm text-muted-foreground">
                  Nenhum lote vinculado.
                </li>
              )}
            </ul>
          </div>

          <div className="flex flex-wrap gap-2 border-t pt-4">
            {canPayShipment(shipment.status) && (
              <Button
                size="sm"
                disabled={pending !== null}
                onClick={() => pay(shipment)}
              >
                {pending === shipment.id ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Wallet />
                )}
                Pagar etiqueta
              </Button>
            )}
            {shipment.status !== "cancelled" && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending !== null}
                onClick={() => sync(shipment)}
              >
                {pending === shipment.id ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <RefreshCw />
                )}
                Sincronizar
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={pending !== null}
              onClick={() => print(shipment)}
            >
              <Printer />
              Etiqueta PDF
            </Button>
            {shipment.tracking_code && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending !== null}
                onClick={() => notify(shipment)}
              >
                <MessageCircle />
                Avisar cliente
              </Button>
            )}
            {canCancelShipment(shipment.status) && (
              <Button
                size="sm"
                variant="destructive"
                disabled={pending !== null}
                onClick={() => cancel(shipment)}
              >
                <Ban />
                Cancelar
              </Button>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Última atualização: {fmtDateTime(shipment.updated_at)} · pedido
            SuperFrete <span className="font-mono">{shipment.sf_order_id}</span>
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
