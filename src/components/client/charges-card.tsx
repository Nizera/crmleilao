"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2, QrCode, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import {
  cancelSelfChargeAction,
  createSelfChargeAction,
  syncSelfChargeAction,
} from "@/app/actions/charges";
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
import {
  chargeExpiryDeltaMs,
  effectiveChargeStatus,
  isChargeActive,
  type Charge,
} from "@/lib/charges";
import { formatBRL, type Lot } from "@/lib/lots";

type Props = {
  lots: Lot[];
  charges: Charge[];
};

/** "Vence em 12h" / "Vence em 3 dias" / "Prazo vencido". */
function expiryText(charge: Charge, now: Date): string | null {
  const delta = chargeExpiryDeltaMs(charge, now);
  if (delta == null) return null;
  if (delta <= 0) return "Prazo vencido";
  const hours = Math.round(delta / 3_600_000);
  if (hours < 48) return `Vence em ${hours}h`;
  return `Vence em ${Math.round(hours / 24)} dias`;
}

export function ClientChargesCard({ lots, charges }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const active = charges.find((charge) => isChargeActive(charge)) ?? null;
  const activeId = active?.id ?? null;

  // A confirmação vem pelo webhook. Enquanto houver um Pix aberto, recarrega
  // a página de tempos em tempos para refletir o pagamento sem F5.
  useEffect(() => {
    if (!activeId) return;
    const timer = setInterval(() => router.refresh(), 20_000);
    return () => clearInterval(timer);
  }, [activeId, router]);

  const activeChargeIds = useMemo(
    () => new Set(charges.filter((charge) => isChargeActive(charge)).map((c) => c.id)),
    [charges],
  );

  // Lote pendente que já está dentro de um Pix aberto não pode entrar em outro.
  const eligibleLots = useMemo(
    () =>
      lots.filter(
        (lot) =>
          lot.status === "pending_payment" &&
          (!lot.charge_id || !activeChargeIds.has(lot.charge_id)),
      ),
    [lots, activeChargeIds],
  );

  const showCart = eligibleLots.length > 0;

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
      setSelected(new Set());
      router.refresh();
    });
  };

  const runSelf = (charge: Charge, kind: "cancel" | "sync") => {
    if (
      kind === "cancel" &&
      !window.confirm(
        `Cancelar o Pix ${charge.code}? Os lotes voltam a ficar disponíveis para gerar outro.`,
      )
    ) {
      return;
    }

    setServerError(null);
    setBusyId(charge.id);
    startTransition(async () => {
      const result =
        kind === "cancel"
          ? await cancelSelfChargeAction(charge.id)
          : await syncSelfChargeAction(charge.id);

      if (!result.ok) setServerError(result.error);
      else if (kind === "cancel") {
        toast.success("Pix cancelado — gere outro quando quiser.");
        setSelected(new Set());
      } else {
        toast.success("Pagamento confirmado!");
      }

      setBusyId(null);
      router.refresh();
    });
  };

  const description = active
    ? "Você tem um Pix aguardando pagamento. Se não conseguiu pagar, cancele e gere outro."
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
        {charges.map((charge) => {
          const shownStatus = effectiveChargeStatus(charge);
          const isActive = activeId === charge.id;
          const expiry = expiryText(charge, new Date());
          const busy = busyId === charge.id;

          return (
            <div
              key={charge.id}
              className="flex flex-col gap-3 rounded-md border p-3"
            >
              <div className="flex items-center justify-between gap-3">
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
                    ) : expiry ? (
                      <>{" · "}{expiry}</>
                    ) : null}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <ChargeStatusBadge status={shownStatus} />
                  {isActive && charge.ticket_url && (
                    <Button asChild size="sm">
                      <a href={charge.ticket_url} target="_blank" rel="noopener noreferrer">
                        <QrCode />
                        Pagar
                      </a>
                    </Button>
                  )}
                </span>
              </div>

              {isActive && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => runSelf(charge, "sync")}
                    disabled={busy || pending}
                  >
                    {busy ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <RefreshCw />
                    )}
                    Já paguei — verificar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => runSelf(charge, "cancel")}
                    disabled={busy || pending}
                  >
                    {busy ? <Loader2 className="animate-spin" /> : <Ban />}
                    Cancelar este Pix
                  </Button>
                </div>
              )}

              {!isActive && shownStatus === "expired" && (
                <p className="text-xs text-muted-foreground">
                  Este Pix venceu e não pode mais ser pago. Gere um novo abaixo.
                </p>
              )}
            </div>
          );
        })}

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
