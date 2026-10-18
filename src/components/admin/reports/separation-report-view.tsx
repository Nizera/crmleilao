"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { getSeparationReportAction } from "@/app/actions/reports";
import { PrintButton } from "@/components/admin/reports/print-button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatPhoneBR } from "@/lib/customers";
import { formatDateBR, LOT_STATUS_LABELS } from "@/lib/lots";
import type { SeparationAddress, SeparationReport } from "@/lib/reports-server";
import { WEEKDAY_LABELS_FULL } from "@/lib/settings";
import { COLOR_DOT, COLOR_LABELS } from "@/lib/stock";

const ALL = "all";

/** Dia da semana por extenso de uma data ISO. Cálculo em UTC puro: idêntico
 *  no servidor e no cliente (sem hydration mismatch). */
function weekdayOf(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return "";
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return WEEKDAY_LABELS_FULL[day] ?? "";
}

function addressLine(address: SeparationAddress): string {
  const street = [address.street, address.number].filter(Boolean).join(", ");
  const withComplement = address.complement
    ? `${street} - ${address.complement}`
    : street;
  const city = [address.city, address.state].filter(Boolean).join("/");
  const place = [address.district, city].filter(Boolean).join(", ");
  const cep = address.cep ? `CEP ${address.cep}` : "";
  return [withComplement, place, cep].filter(Boolean).join(" · ");
}

type Props = {
  initialDate: string;
  initialReport: SeparationReport;
};

export function SeparationReportView({ initialDate, initialReport }: Props) {
  const [date, setDate] = useState(initialDate);
  const [report, setReport] = useState(initialReport);
  const [customerId, setCustomerId] = useState(ALL);
  const [isPending, startTransition] = useTransition();

  // Se a data nova não trouxe o cliente selecionado, volta para "todos".
  const selectedId =
    customerId !== ALL &&
    report.customers.some((customer) => customer.customerId === customerId)
      ? customerId
      : ALL;
  const customers =
    selectedId === ALL
      ? report.customers
      : report.customers.filter(
          (customer) => customer.customerId === selectedId,
        );

  const lotsCount = customers.reduce((sum, c) => sum + c.lots.length, 0);
  const itemsCount = customers.reduce((sum, c) => sum + c.totalItems, 0);

  const changeDate = (value: string) => {
    if (!value) return;
    setDate(value);
    setCustomerId(ALL);
    startTransition(async () => {
      const result = await getSeparationReportAction(value);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setReport(result.data);
    });
  };

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:gap-8 md:p-6 print:gap-0 print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Relatórios</h2>
          <p className="text-sm text-muted-foreground">
            Separação dos arremates por dia de envio.
          </p>
        </div>
        <PrintButton variant="outline" disabled={customers.length === 0} />
      </div>

      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <Field className="w-44">
          <FieldLabel htmlFor="separation-date">Data de envio</FieldLabel>
          <Input
            id="separation-date"
            type="date"
            value={date}
            onChange={(event) => changeDate(event.target.value)}
            disabled={isPending}
          />
        </Field>

        <Field className="w-64">
          <FieldLabel>Cliente</FieldLabel>
          <Select
            value={selectedId}
            onValueChange={setCustomerId}
            disabled={isPending || report.customers.length === 0}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Cliente" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>
                Todos os clientes ({report.customers.length})
              </SelectItem>
              {report.customers.map((customer) => (
                <SelectItem
                  key={customer.customerId}
                  value={customer.customerId}
                >
                  {customer.name ?? "Sem nome"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {isPending && (
          <span className="pb-2 text-sm text-muted-foreground">
            Carregando…
          </span>
        )}
      </div>

      {/* Folha do relatório: é ela que vai para o papel. */}
      <div className="mx-auto w-full max-w-3xl rounded-md border bg-card p-6 print:max-w-none print:rounded-none print:border-0 print:bg-transparent print:p-0">
        <header className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-b pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Caras das Legends · Separação
            </p>
            <h3 className="text-lg font-semibold">
              {formatDateBR(report.shippingDate)}
              <span className="ml-2 font-normal text-muted-foreground">
                {weekdayOf(report.shippingDate)}
              </span>
            </h3>
          </div>
          <p className="text-sm text-muted-foreground">
            {customers.length} {customers.length === 1 ? "cliente" : "clientes"}{" "}
            · {lotsCount} {lotsCount === 1 ? "lote" : "lotes"} · {itemsCount}{" "}
            figurinhas
          </p>
        </header>

        {customers.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Nenhum lote com envio agendado para{" "}
            {formatDateBR(report.shippingDate)}.
          </p>
        ) : (
          customers.map((customer) => {
            const address = addressLine(customer.address);
            return (
              <section key={customer.customerId} className="mb-6 last:mb-0">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 break-after-avoid break-inside-avoid">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <h4 className="text-base font-semibold">
                      {customer.name ?? "Sem nome"}
                    </h4>
                    <span className="font-mono text-xs text-muted-foreground">
                      {formatPhoneBR(customer.phone_e164)}
                    </span>
                  </div>
                  {address && (
                    <span className="text-xs text-muted-foreground">
                      {address}
                    </span>
                  )}
                </div>

                {customer.lots.map((lot) => (
                  <div
                    key={lot.id}
                    className="mb-3 overflow-hidden rounded-md border break-inside-avoid last:mb-0"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b bg-muted/40 px-3 py-1.5 print:bg-transparent">
                      <p className="text-sm">
                        <span className="font-mono font-semibold">
                          {lot.code}
                        </span>
                        <span className="mx-2 text-muted-foreground/60">·</span>
                        {lot.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {LOT_STATUS_LABELS[lot.status]} · {lot.totalItems} un.
                      </p>
                    </div>

                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground">
                          <th className="w-8 px-3 pb-1 font-normal">
                            <span className="sr-only">Conferido</span>
                          </th>
                          <th className="pb-1 font-normal">Figurinha</th>
                          <th className="pb-1 font-normal">Cor</th>
                          <th className="pb-1 pr-3 text-right font-normal">
                            Qtd
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {lot.items.map((item) => (
                          <tr
                            key={`${item.playerName}-${item.color}`}
                            className="border-t"
                          >
                            <td className="px-3 py-1.5">
                              <span className="block size-3.5 border border-foreground/40 print:border-black" />
                            </td>
                            <td className="py-1.5 pr-3">{item.playerName}</td>
                            <td className="py-1.5 pr-3">
                              <span className="flex items-center gap-1.5">
                                <span
                                  className={`size-2.5 rounded-full ${COLOR_DOT[item.color]}`}
                                />
                                {COLOR_LABELS[item.color]}
                              </span>
                            </td>
                            <td className="py-1.5 pr-3 text-right font-medium tabular-nums">
                              {item.qty}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}

                <p className="text-right text-xs text-muted-foreground">
                  {customer.lots.length}{" "}
                  {customer.lots.length === 1 ? "lote" : "lotes"} ·{" "}
                  {customer.totalItems} figurinhas
                </p>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
