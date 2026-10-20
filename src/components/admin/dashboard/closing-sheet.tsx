"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import {
  CheckIcon,
  CopyIcon,
  MessageCircleIcon,
  RefreshCcwIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import {
  deleteStaffPaymentAction,
  getClosingDataAction,
  saveStaffPaymentAction,
} from "@/app/actions/staff-payments";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatBRL, formatDateBR, waMessageLink, waShareLink } from "@/lib/lots";
import {
  moneyToInput,
  type ClosingData,
  type ClosingPendingCharge,
} from "@/lib/staff-payments";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b px-6 py-4 last:border-b-0">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

export function ClosingSheet({ open, onOpenChange }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl"
      >
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle>Fechamento do dia</SheetTitle>
          <SheetDescription>
            Entradas do dia, cobranças em aberto e pagamentos da equipe.
          </SheetDescription>
        </SheetHeader>
        {open && <ClosingPanel />}
      </SheetContent>
    </Sheet>
  );
}

function ClosingPanel() {
  const [data, setData] = useState<ClosingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const applyResult = useCallback(
    (result: Awaited<ReturnType<typeof getClosingDataAction>>) => {
      if (!result.ok) {
        setError(result.error);
        setLoading(false);
        return;
      }
      setData(result.data);
      setDrafts(
        Object.fromEntries(
          result.data.staff.map((member) => [
            member.id,
            member.payment ? moneyToInput(member.payment.amount) : "",
          ]),
        ),
      );
      setLoading(false);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    getClosingDataAction().then((result) => {
      if (cancelled) return;
      applyResult(result);
    });
    return () => {
      cancelled = true;
    };
  }, [applyResult]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getClosingDataAction().then(applyResult);
  }, [applyResult]);

  const summary = useMemo(() => {
    if (!data) return "";
    const paid = data.staff.filter((member) => member.payment).length;
    const missing = data.staff
      .filter((member) => !member.payment)
      .map((member) => member.name?.split(" ")[0] ?? "sem nome");
    return [
      `Fechamento ${formatDateBR(data.date)}`,
      `Recebido hoje: ${formatBRL(data.receivedToday)} (${data.entries.length} lote(s))`,
      data.pendingCharges.length > 0
        ? `A receber: ${data.pendingCharges.length} cliente(s) — ${formatBRL(data.pendingTotal)}`
        : "A receber: nada em aberto",
      `Pagamentos: ${paid} de ${data.staff.length}${
        missing.length > 0
          ? ` (falta: ${missing.join(", ")})`
          : " — tudo pago"
      }`,
    ].join("\n");
  }, [data]);

  const copySummary = () => {
    void navigator.clipboard
      .writeText(summary)
      .then(() => toast.success("Resumo copiado."))
      .catch(() => toast.error("Não foi possível copiar."));
  };

  const shareSummary = () => {
    window.open(waShareLink(summary), "_blank", "noopener");
  };

  const chargeMessage = (charge: ClosingPendingCharge) =>
    `Olá! Sua cobrança ${charge.code} de ${formatBRL(charge.amount)} está pendente.` +
    (charge.ticketUrl ? ` Pix: ${charge.ticketUrl}` : "");

  const savePayment = (staffId: string) => {
    const fd = new FormData();
    fd.append("staff_id", staffId);
    fd.append("payment_date", data?.date ?? "");
    fd.append("amount", drafts[staffId] ?? "");
    setSavingId(staffId);
    startTransition(async () => {
      const result = await saveStaffPaymentAction(fd);
      setSavingId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Pagamento registrado.");
      load();
    });
  };

  const removePayment = (staffId: string, name: string) => {
    if (!data) return;
    if (
      !window.confirm(
        `Remover o pagamento de ${name} em ${formatDateBR(data.date)}?`,
      )
    ) {
      return;
    }
    setSavingId(staffId);
    startTransition(async () => {
      const result = await deleteStaffPaymentAction(staffId, data.date);
      setSavingId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Pagamento removido.");
      load();
    });
  };

  const paidCount = data?.staff.filter((member) => member.payment).length ?? 0;

  if (loading && !data) {
    return <p className="px-6 py-8 text-sm text-muted-foreground">Carregando…</p>;
  }

  if (error) {
    return (
      <div className="m-6 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (!data) return null;

  return (
    <>
      <section className="flex items-center justify-between gap-2 border-b px-6 py-3">
        <span className="text-sm font-medium">{formatDateBR(data.date)}</span>
        <Button size="sm" variant="ghost" disabled={loading} onClick={load}>
          <RefreshCcwIcon className={loading ? "animate-spin" : ""} />
          Atualizar
        </Button>
      </section>

      <Section title="Entradas do dia" hint={formatBRL(data.receivedToday)}>
        {data.entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum lote pago hoje ainda.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {data.entries.map((entry) => (
              <li
                key={entry.code}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="min-w-0">
                  <span className="font-mono font-medium">{entry.code}</span>
                  <span className="ml-2 text-muted-foreground">
                    {entry.customer}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {entry.title}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-medium tabular-nums">
                    {formatBRL(entry.value)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {entry.paidAt.slice(11, 16)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Cobranças em aberto"
        hint={
          data.pendingCharges.length > 0
            ? `${data.pendingCharges.length} · ${formatBRL(data.pendingTotal)}`
            : "nenhuma"
        }
      >
        {data.pendingCharges.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nada a receber no momento.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {data.pendingCharges.map((charge) => (
              <li
                key={charge.id}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="min-w-0">
                  <span className="font-medium">
                    {charge.customerName ?? "Sem nome"}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {charge.code} · {formatBRL(charge.amount)}
                  </span>
                </span>
                <Button size="sm" variant="outline" asChild className="shrink-0">
                  <a
                    href={waMessageLink(charge.phone_e164, chargeMessage(charge))}
                    target="_blank"
                    rel="noopener"
                  >
                    <MessageCircleIcon />
                    Cobrar
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Pagamentos da equipe" hint={`${paidCount} de ${data.staff.length}`}>
        {data.staff.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum membro na equipe.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.staff.map((member) => (
              <li
                key={member.id}
                className="flex flex-wrap items-center gap-2"
              >
                <span className="min-w-0 flex-1 text-sm font-medium">
                  {member.name ?? "Sem nome"}
                  {member.payment && (
                    <CheckIcon className="ml-1.5 inline size-3.5 text-emerald-500" />
                  )}
                </span>
                <Input
                  inputMode="decimal"
                  placeholder="0,00"
                  aria-label={`Valor pago para ${member.name ?? "membro"}`}
                  className="w-24"
                  value={drafts[member.id] ?? ""}
                  onChange={(event) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [member.id]: event.target.value,
                    }))
                  }
                />
                <Button
                  size="sm"
                  disabled={
                    savingId === member.id || !(drafts[member.id] ?? "").trim()
                  }
                  onClick={() => savePayment(member.id)}
                >
                  {member.payment ? "Salvar" : "Registrar"}
                </Button>
                {member.payment && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remover pagamento de ${member.name ?? "membro"}`}
                    disabled={savingId === member.id}
                    onClick={() =>
                      removePayment(member.id, member.name ?? "membro")
                    }
                  >
                    <Trash2Icon className="text-muted-foreground" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Resumo">
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/50 p-3 font-mono text-xs">
          {summary}
        </pre>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={copySummary}>
            <CopyIcon />
            Copiar
          </Button>
          <Button size="sm" variant="outline" onClick={shareSummary}>
            <MessageCircleIcon />
            WhatsApp
          </Button>
        </div>
      </Section>

      {data.history.length > 0 && (
        <Section title="Fechamentos anteriores">
          <ul className="flex flex-col gap-1 text-sm">
            {data.history
              .filter((day) => day.date !== data.date)
              .map((day) => (
                <li
                  key={day.date}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="text-muted-foreground">
                    {formatDateBR(day.date)}
                  </span>
                  <span className="tabular-nums">
                    {formatBRL(day.amount)}
                    <Badge variant="secondary" className="ml-2 text-[10px]">
                      {day.count}
                    </Badge>
                  </span>
                </li>
              ))}
          </ul>
        </Section>
      )}
    </>
  );
}
