"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, QrCode } from "lucide-react";
import { toast } from "sonner";

import { createSelfChargeAction } from "@/app/actions/charges";
import { ChargeStatusBadge } from "@/components/admin/charges/charge-status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateBR } from "@/components/ui/date-br";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isChargeActive, type Charge } from "@/lib/charges";
import { formatBRL, type Lot } from "@/lib/lots";

type Props = {
  lots: Lot[];
  charges: Charge[];
  /** Há lotes aguardando pagamento fora de uma cobrança aberta. */
  canGenerate: boolean;
};

export function ClientChargesCard({ lots, charges, canGenerate }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const active = charges.find((charge) => isChargeActive(charge)) ?? null;

  const eligibleLots = useMemo(
    () => lots.filter((lot) => lot.status === "pending_payment"),
    [lots],
  );

  const showCart = canGenerate && !active;

  const total = useMemo(
    () =>
      eligibleLots
        .filter((lot) => selected.has(lot.id))
        .reduce((sum, lot) => sum + Number(lot.arremate_value), 0),
    [eligibleLots, selected],
  );

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const generate = () => {
    setServerError(null);
    startTransition(async () => {
      const result = await createSelfChargeAction([...selected]);
      if (!result.ok) {
        setServerError(result.error);
        return;
      }
      toast.success(`Cobrança ${result.data.charge.code} criada.`);
      const link = result.data.charge.ticket_url;
      if (link) window.open(link, "_blank", "noopener");
      router.refresh();
    });
  };

  const description = active
    ? "Você tem uma cobrança aguardando pagamento — pague pelo Pix abaixo."
    : showCart
      ? "Selecione os lotes que deseja pagar e gere um único Pix."
      : charges.length > 0
        ? "Histórico das suas cobranças Pix."
        : "Assim que você arrematar um lote, o Pix para pagamento aparece aqui.";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pagamentos</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {charges.map((charge) => (
          <div
            key={charge.id}
            className="flex items-center justify-between gap-3 rounded-md border p-3"
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">
                {charge.lots && charge.lots.length > 0
                  ? `${charge.lots.length} ${charge.lots.length === 1 ? "lote" : "lotes"} · ${charge.code}`
                  : charge.code}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatBRL(charge.amount)}
                {charge.paid_at ? (
                  <>
                    {" · pago em "}
                    <DateBR value={charge.paid_at} />
                  </>
                ) : null}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <ChargeStatusBadge status={charge.status} />
              {isChargeActive(charge) && charge.ticket_url && (
                <Button asChild size="sm">
                  <a href={charge.ticket_url} target="_blank" rel="noopener noreferrer">
                    <QrCode />
                    Pagar
                  </a>
                </Button>
              )}
            </span>
          </div>
        ))}

        {showCart && (
          <>
            <ul className="flex flex-col divide-y rounded-md border">
              {eligibleLots.map((lot) => (
                <li key={lot.id} className="flex items-center gap-3 px-3 py-2.5">
                  <Checkbox
                    id={`lot-${lot.id}`}
                    checked={selected.has(lot.id)}
                    onCheckedChange={() => toggle(lot.id)}
                    disabled={pending}
                  />
                  <label
                    htmlFor={`lot-${lot.id}`}
                    className="flex flex-1 cursor-pointer items-center justify-between gap-3"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {lot.code} · {lot.title}
                      </span>
                    </span>
                    <span className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatBRL(lot.arremate_value)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>

            <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
              <span className="text-sm text-muted-foreground">
                {selected.size} {selected.size === 1 ? "lote selecionado" : "lotes selecionados"}
              </span>
              <span className="text-lg font-semibold">{formatBRL(total)}</span>
            </div>

            {selected.size === 0 ? (
              <p className="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">
                Selecione os lotes que deseja pagar para gerar o Pix.
              </p>
            ) : (
              <Button onClick={generate} disabled={pending}>
                {pending ? <Loader2 className="animate-spin" /> : <QrCode />}
                {pending ? "Gerando…" : "Gerar Pix"}
              </Button>
            )}
          </>
        )}

        {serverError && (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {serverError}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
