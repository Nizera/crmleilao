"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, QrCode } from "lucide-react";
import { toast } from "sonner";

import { createSelfChargeAction } from "@/app/actions/charges";
import { ChargeStatusBadge } from "@/components/admin/charges/charge-status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isChargeActive, type Charge } from "@/lib/charges";
import { formatBRL } from "@/lib/lots";

type Props = {
  charges: Charge[];
  /** Há lotes aguardando pagamento fora de uma cobrança aberta. */
  canGenerate: boolean;
};

export function ClientChargesCard({ charges, canGenerate }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const active = charges.find((charge) => isChargeActive(charge)) ?? null;

  const generate = () => {
    setServerError(null);
    startTransition(async () => {
      const result = await createSelfChargeAction();
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pagamentos</CardTitle>
        <CardDescription>
          {active
            ? "Você tem uma cobrança aguardando pagamento — pague pelo Pix abaixo."
            : canGenerate
              ? "Seus lotes pendentes podem virar um único Pix agora."
              : charges.length > 0
                ? "Histórico das suas cobranças Pix."
                : "Assim que você arrematar um lote, o Pix para pagamento aparece aqui."}
        </CardDescription>
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
                {charge.paid_at
                  ? ` · pago em ${new Date(charge.paid_at).toLocaleDateString("pt-BR")}`
                  : ""}
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

        {canGenerate && !active && (
          <Button onClick={generate} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <QrCode />}
            {pending ? "Gerando…" : "Gerar Pix dos meus lotes pendentes"}
          </Button>
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
