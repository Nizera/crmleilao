"use client";

import { useEffect, useState, useTransition } from "react";
import { ArrowLeft, Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";

import {
  createChargeAction,
  loadChargeContext,
  searchChargeCustomers,
} from "@/app/actions/charges";
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
import type { Charge, ChargeLotRef } from "@/lib/charges";
import { WEEKLY_FREIGHT } from "@/lib/freight";
import type { Customer } from "@/lib/dal";
import { formatBRL } from "@/lib/lots";
import { formatPhoneBR } from "@/lib/customers";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (charge: Charge) => void;
};

type Context = {
  active: { id: string; code: string; amount: number; expires_at: string | null } | null;
  lots: ChargeLotRef[];
  freightDue: boolean;
};

export function ChargeFormSheet({ open, onOpenChange, onCreated }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl"
      >
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle>Nova cobrança Pix</SheetTitle>
          <SheetDescription>
            Agrupe os lotes aguardando pagamento de um cliente em um único Pix.
          </SheetDescription>
        </SheetHeader>
        {open && <ChargeForm onDone={(charge) => onCreated(charge)} />}
      </SheetContent>
    </Sheet>
  );
}

function ChargeForm({ onDone }: { onDone: (charge: Charge) => void }) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Customer[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [selected, setSelected] = useState<Customer | null>(null);
  const [context, setContext] = useState<Context | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [withFreight, setWithFreight] = useState(false);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;

    loadChargeContext(selected.id)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setContext(result.data);
          // Marca todos por padrão: o comum é cobrar tudo de uma vez.
          setPicked(new Set(result.data.lots.map((lot) => lot.id)));
        } else {
          setServerError(result.error);
        }
      })
      .catch(() => {
        if (!cancelled) setServerError("Falha ao carregar os lotes do cliente.");
      })
      .finally(() => {
        if (!cancelled) setLoadingContext(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selected]);

  const search = (event: React.FormEvent) => {
    event.preventDefault();
    setServerError(null);
    setSearching(true);

    searchChargeCustomers(query)
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
    setWithFreight(false);
    setServerError(null);
    setLoadingContext(true);
  };

  const toggleLot = (id: string) => {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const total =
    (context?.lots
      .filter((lot) => picked.has(lot.id))
      .reduce((sum, lot) => sum + Number(lot.arremate_value), 0) ?? 0) +
    (withFreight ? WEEKLY_FREIGHT : 0);

  const generate = () => {
    if (!selected) return;
    setServerError(null);

    const fd = new FormData();
    fd.append("customer_id", selected.id);
    fd.append("lot_ids", JSON.stringify([...picked]));
    if (withFreight) fd.append("freight", "true");

    startTransition(async () => {
      const result = await createChargeAction(fd);
      if (!result.ok) {
        setServerError(result.error);
        return;
      }
      toast.success(`Cobrança ${result.data.charge.code} criada.`);
      onDone(result.data.charge);
    });
  };

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
            <label htmlFor="charge-customer" className="text-sm font-medium">
              Cliente
            </label>
            <div className="flex gap-2">
              <Input
                id="charge-customer"
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
            <div>
              <p className="font-medium">{selected.name ?? "Sem nome"}</p>
              <p className="text-sm text-muted-foreground">
                {formatPhoneBR(selected.phone_e164)}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelected(null);
                setContext(null);
                setServerError(null);
                setLoadingContext(false);
              }}
            >
              <ArrowLeft />
              Trocar
            </Button>
          </div>

          {loadingContext && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Carregando lotes…
            </p>
          )}

          {context?.active && (
            <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-400">
              <p>
                Já existe a cobrança <strong>{context.active.code}</strong> aguardando
                pagamento ({formatBRL(context.active.amount)}).
              </p>
              <p>
                Cancele a cobrança atual na lista para agrupar outros lotes.
              </p>
            </div>
          )}

          {context && !loadingContext && (
            <>
              {context.lots.length === 0 ? (
                <p className="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">
                  Nenhum lote elegível: ou não há lotes aguardando pagamento, ou
                  todos já estão numa cobrança.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">
                    Lotes aguardando pagamento
                  </p>
                  <ul className="flex flex-col divide-y rounded-md border">
                    {context.lots.map((lot) => (
                      <li
                        key={lot.id}
                        className="flex items-center gap-3 px-3 py-2.5"
                      >
                        <Checkbox
                          id={`lot-${lot.id}`}
                          checked={picked.has(lot.id)}
                          onCheckedChange={() => toggleLot(lot.id)}
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
                </div>
              )}

              {context.freightDue && (
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">Frete da semana</p>
                  <div className="flex items-center gap-3 rounded-md border px-3 py-2.5">
                    <Checkbox
                      id="charge-freight"
                      checked={withFreight}
                      onCheckedChange={(value) => setWithFreight(value === true)}
                      disabled={pending}
                    />
                    <label
                      htmlFor="charge-freight"
                      className="flex flex-1 cursor-pointer items-center justify-between gap-3"
                    >
                      <span className="text-sm font-medium">
                        Frete da semana
                        <span className="block text-xs font-normal text-muted-foreground">
                          cobrança única do período (terça a terça)
                        </span>
                      </span>
                      <span className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatBRL(WEEKLY_FREIGHT)}
                      </span>
                    </label>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
                <span className="text-sm text-muted-foreground">
                  {picked.size} {picked.size === 1 ? "lote selecionado" : "lotes selecionados"}
                  {withFreight ? " + frete da semana" : ""}
                </span>
                <span className="text-lg font-semibold">{formatBRL(total)}</span>
              </div>
            </>
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

      {selected && context && (
        <div className="mt-auto flex items-center justify-end gap-2 border-t pt-4">
          <Button
            type="button"
            disabled={pending || (picked.size === 0 && !withFreight) || !!context.active}
            onClick={generate}
          >
            {pending ? "Gerando…" : <Plus />}
            Gerar Pix
          </Button>
        </div>
      )}
    </form>
  );
}
