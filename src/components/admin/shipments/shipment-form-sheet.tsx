"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { ArrowLeft, Loader2, Plus, Search, Truck } from "lucide-react";
import { toast } from "sonner";

import {
  emitShipmentAction,
  loadShipmentContext,
  quoteShipmentAction,
  searchShipmentCustomers,
  type ShipmentContext,
} from "@/app/actions/shipments";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Customer } from "@/lib/dal";
import { formatPhoneBR } from "@/lib/customers";
import { formatBRL } from "@/lib/lots";
import type { SfQuoteOption } from "@/lib/superfrete";
import type { Shipment } from "@/lib/shipments";
import { defaultShipmentVolume } from "@/lib/shipments";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (shipment: Shipment) => void;
  /** Abre já com esse cliente escolhido (fila de envios). */
  initialCustomer?: { id: string; name: string | null; phone_e164: string } | null;
  /** Rótulo do cabeçalho. */
  title?: string;
};

type Volume = { height: number; width: number; length: number; weight: number };

export function ShipmentFormSheet({
  open,
  onOpenChange,
  onCreated,
  initialCustomer,
  title = "Novo envio",
}: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl"
      >
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            Agrupe os lotes pagos de um cliente, cotar e emita a etiqueta
            SuperFrete.
          </SheetDescription>
        </SheetHeader>
        {open && (
          <ShipmentForm
            onDone={(shipment) => onCreated(shipment)}
            initialCustomer={initialCustomer}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function ShipmentForm({
  onDone,
  initialCustomer,
}: {
  onDone: (shipment: Shipment) => void;
  initialCustomer?: { id: string; name: string | null; phone_e164: string } | null;
}) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Customer[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [selected, setSelected] = useState<Customer | null>(
    initialCustomer
      ? {
          id: initialCustomer.id,
          name: initialCustomer.name,
          phone_e164: initialCustomer.phone_e164,
        }
      : null,
  );
  const [context, setContext] = useState<ShipmentContext | null>(null);
  const [loadingContext, setLoadingContext] = useState(Boolean(initialCustomer));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [batchDate, setBatchDate] = useState("");
  const [volume, setVolume] = useState<Volume>({
    height: 6,
    width: 16,
    length: 23,
    weight: 0.3,
  });
  const [volumeTouched, setVolumeTouched] = useState(false);

  const [step, setStep] = useState<"form" | "quote">("form");
  const [options, setOptions] = useState<SfQuoteOption[] | null>(null);
  const [quoteNotes, setQuoteNotes] = useState<string[]>([]);
  const [quoting, setQuoting] = useState(false);
  const [serviceId, setServiceId] = useState<number | null>(null);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;

    loadShipmentContext(selected.id)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setContext(result.data);
          setPicked(new Set(result.data.lots.map((lot) => lot.id)));
          setBatchDate(result.data.defaultBatchDate ?? "");
          setVolume(result.data.defaultVolume);
          setVolumeTouched(false);
        } else {
          setServerError(result.error);
        }
      })
      .catch(() => {
        if (!cancelled) setServerError("Falha ao carregar os dados do cliente.");
      })
      .finally(() => {
        if (!cancelled) setLoadingContext(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selected]);

  const search = (event: FormEvent) => {
    event.preventDefault();
    setServerError(null);
    setSearching(true);

    searchShipmentCustomers(query)
      .then((result) => {
        if (result.ok) setResults(result.data);
        else setServerError(result.error);
      })
      .finally(() => setSearching(false));
  };

  const pickCustomer = (customer: Customer) => {
    setSelected(customer);
    setContext(null);
    setPicked(new Set());
    setServerError(null);
    setStep("form");
    setOptions(null);
    setServiceId(null);
    setLoadingContext(true);
  };

  const resetCustomer = () => {
    setSelected(null);
    setContext(null);
    setServerError(null);
    setLoadingContext(false);
    setStep("form");
    setOptions(null);
    setServiceId(null);
  };

  const toggleLot = (id: string) => {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);

      if (!volumeTouched) {
        setVolume(defaultShipmentVolume(next.size));
      }
      return next;
    });
  };

  const setVolumeField = (field: keyof Volume, value: string) => {
    const numeric = Number(value);
    setVolumeTouched(true);
    setVolume((current) => ({
      ...current,
      [field]: Number.isFinite(numeric) ? numeric : 0,
    }));
  };

  const pickedLots =
    context?.lots.filter((lot) => picked.has(lot.id)) ?? [];
  const total = pickedLots.reduce(
    (sum, lot) => sum + Number(lot.arremate_value),
    0,
  );

  const blockedReason = (() => {
    if (!context) return null;
    if (!context.superfreteReady) {
      return "SuperFrete não configurada — defina SUPERFRETE_TOKEN no .env e reinicie.";
    }
    if (!context.originReady) {
      return "Endereço de origem incompleto — preencha em Configuração.";
    }
    if (context.missing.length > 0) {
      return `Faltam dados do destinatário: ${context.missing.join(", ")}.`;
    }
    if (picked.size === 0) return "Selecione ao menos um lote.";
    return null;
  })();

  const startQuote = () => {
    if (!selected) return;
    setServerError(null);
    setQuoting(true);

    quoteShipmentAction({
      customerId: selected.id,
      lotIds: [...picked],
      volume,
    })
      .then((result) => {
        if (result.ok) {
          setOptions(result.data.options);
          setQuoteNotes(result.data.errors);
          setServiceId(result.data.options[0]?.id ?? null);
          setStep("quote");
        } else {
          setServerError(result.error);
        }
      })
      .catch(() => setServerError("Falha ao cotar o frete."))
      .finally(() => setQuoting(false));
  };

  const emit = () => {
    if (!selected || serviceId == null) return;
    setServerError(null);

    startTransition(async () => {
      const result = await emitShipmentAction({
        customerId: selected.id,
        lotIds: [...picked],
        serviceId,
        volume,
        batchDate: batchDate || null,
      });

      if (!result.ok) {
        setServerError(result.error);
        return;
      }

      toast.success(`Envio ${result.data.shipment.code} criado.`);
      if (result.data.warning) toast.warning(result.data.warning);
      onDone(result.data.shipment);
    });
  };

  const optionLabel = (option: SfQuoteOption) => ({
    // `price` já vem com o desconto da SuperFrete aplicado (a doc define
    // price como "valor total do frete"); `discount` é apenas informativo.
    final: option.price,
    text: `${option.carrier ? `${option.carrier} · ` : ""}${option.name}`,
    prazo: option.deliveryTime,
  });

  return (
    <form
      className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-5"
      onSubmit={(event) => {
        if (!selected) search(event);
        else event.preventDefault();
      }}
      noValidate
    >
      {!selected ? (
        <>
          <div className="flex flex-col gap-2">
            <label htmlFor="shipment-customer" className="text-sm font-medium">
              Cliente
            </label>
            <div className="flex gap-2">
              <Input
                id="shipment-customer"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Nome ou WhatsApp com DDD"
                autoComplete="off"
              />
              <Button type="submit" variant="outline" disabled={searching}>
                {searching ? <Loader2 className="animate-spin" /> : <Search />}
                Buscar
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Mínimo 2 letras ou 4 dígitos.
            </p>
          </div>

          {results && results.length === 0 && (
            <p className="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">
              Nenhum cliente encontrado.
            </p>
          )}

          {results && results.length > 0 && (
            <ul className="flex flex-col divide-y rounded-md border">
              {results.map((customer) => (
                <li key={customer.id}>
                  <button
                    type="button"
                    onClick={() => pickCustomer(customer)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-muted"
                  >
                    <span className="font-medium">{customer.name ?? "Sem nome"}</span>
                    <span className="text-sm text-muted-foreground">
                      {formatPhoneBR(customer.phone_e164)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate font-medium">
                {selected.name ?? "Sem nome"}
              </p>
              <p className="text-sm text-muted-foreground">
                {formatPhoneBR(selected.phone_e164)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {context?.sandbox && (
                <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                  sandbox
                </span>
              )}
              <Button type="button" variant="ghost" size="sm" onClick={resetCustomer}>
                <ArrowLeft />
                Trocar
              </Button>
            </div>
          </div>

          {loadingContext && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Carregando dados do cliente…
            </p>
          )}

          {context && !loadingContext && step === "form" && (
            <>
              {context.missing.length > 0 && (
                <div className="flex flex-col gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-400">
                  <p className="font-medium">Faltam dados para a etiqueta:</p>
                  <p>{context.missing.join(", ")}.</p>
                  <p className="text-xs">
                    Preencha na ficha do cliente e abra de novo.
                  </p>
                </div>
              )}

              {context.addressLine && (
                <div className="rounded-md border px-3 py-2.5 text-sm">
                  <p className="text-xs font-medium text-muted-foreground">
                    Entrega em
                  </p>
                  <p>{context.addressLine}</p>
                </div>
              )}

              {context.lots.length === 0 ? (
                <p className="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">
                  Nenhum lote pago disponível: todos já estão em envio ou ainda
                  não foram pagos.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">Lotes pagos para enviar</p>
                  <ul className="flex flex-col divide-y rounded-md border">
                    {context.lots.map((lot) => (
                      <li
                        key={lot.id}
                        className="flex items-center gap-3 px-3 py-2.5"
                      >
                        <Checkbox
                          id={`ship-lot-${lot.id}`}
                          checked={picked.has(lot.id)}
                          onCheckedChange={() => toggleLot(lot.id)}
                          disabled={pending}
                        />
                        <label
                          htmlFor={`ship-lot-${lot.id}`}
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
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="batch-date" className="text-sm font-medium">
                    Data do envio (terça)
                  </label>
                  <Input
                    id="batch-date"
                    type="date"
                    value={batchDate}
                    onChange={(event) => setBatchDate(event.target.value)}
                    disabled={pending}
                  />
                </div>
                <div className="flex flex-col justify-end">
                  <div className="flex items-center justify-between rounded-md border px-3 py-2">
                    <span className="text-sm text-muted-foreground">
                      {picked.size} {picked.size === 1 ? "lote" : "lotes"}
                    </span>
                    <span className="font-semibold">{formatBRL(total)}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Caixa</p>
                  {!volumeTouched && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() =>
                        setVolume(defaultShipmentVolume(Math.max(1, picked.size)))
                      }
                    >
                      Padrão
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {(
                    [
                      ["height", "Altura", "cm"],
                      ["width", "Largura", "cm"],
                      ["length", "Compr.", "cm"],
                      ["weight", "Peso", "kg"],
                    ] as const
                  ).map(([field, label, unit]) => (
                    <div key={field} className="flex flex-col gap-1">
                      <label
                        htmlFor={`volume-${field}`}
                        className="text-xs text-muted-foreground"
                      >
                        {label} ({unit})
                      </label>
                      <Input
                        id={`volume-${field}`}
                        inputMode="decimal"
                        value={String(volume[field])}
                        onChange={(event) =>
                          setVolumeField(field, event.target.value)
                        }
                        disabled={pending}
                      />
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  A mesma caixa vai para o cálculo e para a etiqueta — a
                  SuperFrete exige consistência.
                </p>
              </div>
            </>
          )}

          {context && !loadingContext && step === "quote" && options && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Opções de frete</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setStep("form")}
                >
                  <ArrowLeft className="size-3.5" />
                  Voltar
                </Button>
              </div>

              {quoteNotes.length > 0 && (
                <ul className="flex flex-col gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                  {quoteNotes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              )}

              <ul className="flex flex-col gap-2">
                {options.map((option) => {
                  const meta = optionLabel(option);
                  const active = serviceId === option.id;
                  return (
                    <li key={option.id}>
                      <button
                        type="button"
                        onClick={() => setServiceId(option.id)}
                        className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left transition ${
                          active
                            ? "border-foreground bg-muted/60"
                            : "hover:bg-muted/50"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {meta.text}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {meta.prazo > 0
                              ? `${meta.prazo} dia${meta.prazo === 1 ? "" : "s"} úteis`
                              : "prazo não informado"}
                          </span>
                        </span>
                        <span className="whitespace-nowrap text-sm font-semibold">
                          {formatBRL(meta.final)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              <p className="text-xs text-muted-foreground">
                O valor é debitado da carteira SuperFrete ao emitir.
              </p>
            </div>
          )}

          {serverError && (
            <p
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {serverError}
            </p>
          )}
        </>
      )}

      {selected && context && !loadingContext && (
        <div className="mt-auto flex flex-col gap-2 border-t pt-4">
          {step === "form" && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {picked.size > 0
                  ? `Seguro declarado: ${formatBRL(total)}`
                  : "Selecione os lotes para cotar."}
              </p>
              <Button
                type="button"
                onClick={startQuote}
                disabled={quoting || blockedReason !== null}
                title={blockedReason ?? undefined}
              >
                {quoting ? <Loader2 className="animate-spin" /> : <Truck />}
                Cotar frete
              </Button>
            </div>
          )}
          {step === "quote" && (
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setStep("form")}>
                Voltar
              </Button>
              <Button
                type="button"
                disabled={pending || serviceId == null}
                onClick={emit}
              >
                {pending ? (
                  "Emitindo…"
                ) : (
                  <Plus />
                )}
                Emitir etiqueta
              </Button>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
