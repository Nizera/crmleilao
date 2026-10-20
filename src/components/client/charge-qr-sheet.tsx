"use client";

import { useState } from "react";
import { Copy, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { getSelfChargeQrAction } from "@/app/actions/charges";
import { Button } from "@/components/ui/button";
import { DateBR } from "@/components/ui/date-br";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { chargeQRDataUrl } from "@/lib/charges";
import { formatBRL } from "@/lib/lots";

type QrData = {
  code: string;
  amount: number;
  expires_at: string | null;
  ticket_url: string | null;
  qr_code: string | null;
  qr_code_base64: string | null;
  freight_amount: number;
  lots: { code: string; title: string }[];
};

type QrState = {
  id: string;
  data: QrData | null;
  error: string | null;
  loading: boolean;
};

/**
 * Abre o QR do Pix dentro do próprio painel.
 *
 * O QR vem do servidor na hora (getSelfChargeQrAction) em vez de viajar em
 * todas as listagens: assim a listagem de histórico não precisa carregar o
 * base64 de 200 QR que ninguém abre.
 */
export function useChargeQr() {
  const [state, setState] = useState<QrState | null>(null);

  const open = (chargeId: string) => {
    setState({ id: chargeId, data: null, error: null, loading: true });
    void getSelfChargeQrAction(chargeId).then((result) => {
      setState((prev) => {
        if (!prev || prev.id !== chargeId) return prev;
        return {
          id: chargeId,
          loading: false,
          data: result.ok ? result.data : null,
          error: result.ok ? null : result.error,
        };
      });
    });
  };

  const close = () => setState(null);

  const sheet = state ? (
    <Sheet open onOpenChange={(openNow) => (!openNow ? close() : undefined)}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md"
      >
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle>
            {state.data ? `Pix ${state.data.code}` : "Pix"}
          </SheetTitle>
          <SheetDescription>
            Aponte a câmera para o QR ou use o copia e cola.
          </SheetDescription>
        </SheetHeader>
        <ChargeQrBody state={state} onClose={close} />
      </SheetContent>
    </Sheet>
  ) : null;

  return { open, sheet };
}

function ChargeQrBody({ state, onClose }: { state: QrState; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const data = state.data;

  const copy = async () => {
    if (!data?.qr_code) return;
    try {
      await navigator.clipboard.writeText(data.qr_code);
      setCopied(true);
      toast.success("Pix copia e cola copiado.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Não foi possível copiar. Selecione o texto manualmente.");
    }
  };

  if (state.loading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 px-6 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Carregando QR…
      </div>
    );
  }

  if (state.error || !data) {
    return (
      <div className="flex flex-1 flex-col gap-4 px-6 py-5">
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {state.error ?? "Não foi possível carregar o QR."}
        </p>
        <Button type="button" variant="outline" className="mt-auto" onClick={onClose}>
          Fechar
        </Button>
      </div>
    );
  }

  const qrDataUrl = chargeQRDataUrl(data.qr_code_base64);
  const expired = Boolean(data.expires_at && new Date(data.expires_at) < new Date());

  return (
    <div className="flex flex-1 flex-col gap-5 px-6 py-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-2xl font-semibold text-ouro-ink">{formatBRL(data.amount)}</p>
          {data.freight_amount > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Inclui frete da semana: {formatBRL(data.freight_amount)}
            </p>
          )}
          {data.lots.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Lotes: {data.lots.map((lot) => lot.code).join(", ")}
            </p>
          )}
        </div>
        {data.expires_at && !expired && (
          <p className="text-right text-xs text-muted-foreground">
            Válido até
            <br />
            <DateBR time value={data.expires_at} />
          </p>
        )}
      </div>

      {expired ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          O prazo deste Pix venceu. Gere um novo no card de pagamentos.
        </p>
      ) : qrDataUrl ? (
        <div className="flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrDataUrl}
            alt={`QR Code Pix da cobrança ${data.code}`}
            className="size-56 rounded-md border bg-white p-2"
          />
        </div>
      ) : data.ticket_url ? (
        <Button asChild variant="outline">
          <a href={data.ticket_url} target="_blank" rel="noopener noreferrer">
            <ExternalLink />
            Abrir página de pagamento
          </a>
        </Button>
      ) : (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          QR indisponível. Gere a cobrança novamente.
        </p>
      )}

      {!expired && data.qr_code && (
        <div className="flex flex-col gap-2">
          <label htmlFor={`pix-${data.code}`} className="text-sm font-medium">
            Pix copia e cola
          </label>
          <textarea
            id={`pix-${data.code}`}
            readOnly
            value={data.qr_code}
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
        {!expired && data.ticket_url && (
          <Button asChild variant="outline">
            <a href={data.ticket_url} target="_blank" rel="noopener noreferrer">
              <ExternalLink />
              Abrir no Mercado Pago
            </a>
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onClose}>
          Fechar
        </Button>
      </div>
    </div>
  );
}
