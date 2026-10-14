"use client";

import { useState, useTransition } from "react";
import { Copy, ExternalLink, MessageCircle } from "lucide-react";
import { toast } from "sonner";

import { logWaMessage } from "@/app/actions/lots";
import { Button } from "@/components/ui/button";
import { DateBR } from "@/components/ui/date-br";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  buildChargeMessage,
  chargeQRDataUrl,
  isChargeActive,
  type Charge,
} from "@/lib/charges";
import { formatBRL, waMessageLink } from "@/lib/lots";
import { formatPhoneBR } from "@/lib/customers";

type Props = {
  charge: Charge | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentTemplate: string;
};

export function ChargeQrSheet({ charge, open, onOpenChange, paymentTemplate }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md">
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle>
            {charge ? `Cobrança ${charge.code}` : "Cobrança"}
          </SheetTitle>
          <SheetDescription>Mostre o QR ou envie o Pix no WhatsApp.</SheetDescription>
        </SheetHeader>
        {charge && (
          <ChargeQrPanel
            key={charge.id}
            charge={charge}
            paymentTemplate={paymentTemplate}
            onDone={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

export function ChargeQrPanel({
  charge,
  paymentTemplate,
  onDone,
}: {
  charge: Charge;
  paymentTemplate: string;
  onDone: () => void;
}) {
  const [, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  const qrDataUrl = chargeQRDataUrl(charge.qr_code_base64);
  const active = isChargeActive(charge);
  const lotCodes = charge.lots?.map((lot) => lot.code).join(", ") ?? "";

  const copy = async () => {
    if (!charge.qr_code) return;
    try {
      await navigator.clipboard.writeText(charge.qr_code);
      setCopied(true);
      toast.success("Pix copia e cola copiado.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Não foi possível copiar. Selecione o texto manualmente.");
    }
  };

  const sendWhatsApp = () => {
    if (!charge.customer?.phone_e164) return;
    const message = buildChargeMessage(charge, paymentTemplate);
    const link = waMessageLink(charge.customer.phone_e164, message);

    startTransition(async () => {
      await logWaMessage({
        customer_id: charge.customer_id,
        kind: "payment_request",
        text_body: message,
        link,
      }).catch(() => null);
      window.open(link, "_blank", "noopener");
    });
  };

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-2xl font-semibold">{formatBRL(charge.amount)}</p>
          <p className="text-sm text-muted-foreground">
            {charge.customer?.name ?? "Cliente"}
            {charge.customer ? ` · ${formatPhoneBR(charge.customer.phone_e164)}` : ""}
          </p>
          {lotCodes && (
            <p className="mt-1 text-xs text-muted-foreground">
              Lotes: {lotCodes}
            </p>
          )}
        </div>
        {active && charge.expires_at && (
          <p className="text-right text-xs text-muted-foreground">
            Válido até
            <br />
            <DateBR time value={charge.expires_at} />
          </p>
        )}
      </div>

      {active ? (
        qrDataUrl ? (
          <div className="flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDataUrl}
              alt={`QR Code Pix da cobrança ${charge.code}`}
              className="size-56 rounded-md border bg-white p-2"
            />
          </div>
        ) : charge.ticket_url ? (
          <Button asChild variant="outline">
            <a href={charge.ticket_url} target="_blank" rel="noopener noreferrer">
              <ExternalLink />
              Abrir página de pagamento
            </a>
          </Button>
        ) : (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
            QR indisponível. Gere a cobrança novamente.
          </p>
        )
      ) : (
        <p className="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">
          Esta cobrança não está mais aguardando pagamento.
        </p>
      )}

      {active && charge.qr_code && (
        <div className="flex flex-col gap-2">
          <label htmlFor={`pix-${charge.code}`} className="text-sm font-medium">
            Pix copia e cola
          </label>
          <textarea
            id={`pix-${charge.code}`}
            readOnly
            value={charge.qr_code}
            rows={3}
            className="w-full resize-none rounded-md border bg-muted px-3 py-2 font-mono text-xs"
            onFocus={(event) => event.target.select()}
          />
          <Button type="button" variant="outline" onClick={copy}>
            <Copy />
            {copied ? "Copiado!" : "Copiar código"}
          </Button>
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2 border-t pt-4">
        {active && charge.customer?.phone_e164 && (
          <Button type="button" onClick={sendWhatsApp}>
            <MessageCircle />
            Enviar no WhatsApp
          </Button>
        )}
        <div className="flex gap-2">
          {active && charge.ticket_url && qrDataUrl && (
            <Button asChild variant="outline" className="flex-1">
              <a href={charge.ticket_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink />
                Abrir no MP
              </a>
            </Button>
          )}
          <Button type="button" variant="outline" className="flex-1" onClick={onDone}>
            Fechar
          </Button>
        </div>
      </div>
    </div>
  );
}
