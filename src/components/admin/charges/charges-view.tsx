"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  Plus,
  QrCode,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import {
  cancelChargeAction,
  getChargeQrAction,
  markChargePaidAction,
  syncChargeAction,
  syncPendingChargesAction,
} from "@/app/actions/charges";
import { ChargeFormSheet } from "@/components/admin/charges/charge-form-sheet";
import { ChargeQrSheet } from "@/components/admin/charges/charge-qr-sheet";
import { ChargeStatusBadge } from "@/components/admin/charges/charge-status-badge";
import { Button } from "@/components/ui/button";
import { DateBR } from "@/components/ui/date-br";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CHARGE_STATUSES,
  CHARGE_STATUS_LABELS,
  isChargeActive,
  isChargeOpen,
  type Charge,
} from "@/lib/charges";
import { formatBRL } from "@/lib/lots";
import { formatPhoneBR } from "@/lib/customers";

type Props = {
  rows: Charge[];
  total: number;
  page: number;
  pageSize: number;
  q: string;
  status: string;
  qTruncated?: boolean;
  paymentTemplate: string;
  mpReady: boolean;
  webhookReady: boolean;
  signatureReady: boolean;
  migrationReady: boolean;
};

export function ChargesView({
  rows,
  total,
  page,
  pageSize,
  q,
  status,
  qTruncated,
  paymentTemplate,
  mpReady,
  webhookReady,
  signatureReady,
  migrationReady,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Status e prazo mudam pelo webhook sem ninguém clicar: a tela se atualiza
  // sozinha (mesmo intervalo de 20 s do Pix ativo no painel do cliente).
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 20_000);
    return () => clearInterval(timer);
  }, [router]);

  const [query, setQuery] = useState(q);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [qrCharge, setQrCharge] = useState<Charge | null>(null);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  const buildHref = (nextQuery: string, nextStatus: string, nextPage: number) => {
    const params = new URLSearchParams();
    if (nextQuery.trim()) params.set("q", nextQuery.trim());
    if (nextStatus !== "all") params.set("status", nextStatus);
    if (nextPage > 1) params.set("p", String(nextPage));
    const search = params.toString();
    return `/admin/cobrancas${search ? `?${search}` : ""}`;
  };

  const search = (event: FormEvent) => {
    event.preventDefault();
    router.replace(buildHref(query, status, 1));
  };

  const changeStatus = (value: string) => {
    router.replace(buildHref(query, value, 1));
  };

  const runAction = (charge: Charge, action: "paid" | "cancel") => {
    const confirmed = window.confirm(
      action === "paid"
        ? `Marcar a cobrança ${charge.code} como paga? Os lotes dela passam a Pago.`
        : `Cancelar a cobrança ${charge.code}? Os lotes voltam a ficar disponíveis para nova cobrança.`,
    );
    if (!confirmed) return;

    setBusyId(charge.id);
    startTransition(async () => {
      const result =
        action === "paid"
          ? await markChargePaidAction(charge.id)
          : await cancelChargeAction(charge.id);

      if (!result.ok) toast.error(result.error);
      else toast.success(action === "paid" ? "Cobrança marcada como paga." : "Cobrança cancelada.");
      setBusyId(null);
    });
  };

  const runSync = (charge: Charge) => {
    setBusyId(charge.id);
    startTransition(async () => {
      const result = await syncChargeAction(charge.id);
      if (result.ok) toast.success(`Cobrança ${charge.code} sincronizada com o Mercado Pago.`);
      else toast.error(result.error);
      setBusyId(null);
    });
  };

  const openQr = (charge: Charge) => {
    setBusyId(charge.id);
    startTransition(async () => {
      const result = await getChargeQrAction(charge.id);
      if (result.ok) setQrCharge(result.data);
      else toast.error(result.error);
      setBusyId(null);
    });
  };

  const runSyncAll = () => {
    const confirmed = window.confirm(
      "Consultar o Mercado Pago para as cobranças pendentes?\n\n" +
        "As que já foram pagas lá passam a constar como pagas aqui (e os lotes como Pago). " +
        "As expiradas são marcadas como Expirada e liberam os lotes.",
    );
    if (!confirmed) return;

    setSyncingAll(true);
    startTransition(async () => {
      const result = await syncPendingChargesAction();
      setSyncingAll(false);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      const { checked, applied, skipped } = result.data;
      const reasons = Object.values(skipped).reduce<Record<string, number>>((acc, reason) => {
        acc[reason] = (acc[reason] ?? 0) + 1;
        return acc;
      }, {});
      const detail = Object.entries(reasons)
        .map(([reason, count]) => `${count}× ${reason.replace(/_/g, " ")}`)
        .join(" · ");

      if (applied > 0) {
        toast.success(
          `${applied} ${applied === 1 ? "cobrança atualizada" : "cobranças atualizadas"} no Mercado Pago ` +
            `(${checked} conferida${checked === 1 ? "" : "s"}).`,
        );
      } else {
        toast.info(`Nada mudou: ${checked} cobrança${checked === 1 ? "" : "s"} conferida(s).`);
      }
      if (detail) toast.message(`Não aplicado — ${detail}.`);
    });
  };

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:gap-8 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Cobranças</h2>
          <p className="text-sm text-muted-foreground">
            {total === 0
              ? "Nenhuma cobrança ainda — agrupe lotes e gere o Pix."
              : `${total} ${total === 1 ? "cobrança" : "cobranças"} no total.`}
          </p>
          {qTruncated && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              A busca por cliente passou de 300 correspondências — refine o
              termo para enxergar todas.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={runSyncAll}
            disabled={!mpReady || syncingAll}
            title={
              mpReady
                ? "Consulta o Mercado Pago e aplica o status de cada cobrança pendente."
                : "Configure MP_ACCESS_TOKEN para consultar o Mercado Pago."
            }
          >
            {syncingAll ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Sincronizar pendentes
          </Button>
          <Button
            onClick={() => setFormOpen(true)}
            disabled={!mpReady}
            title={mpReady ? undefined : "Configure MP_ACCESS_TOKEN para gerar Pix."}
          >
            <Plus />
            Nova cobrança
          </Button>
        </div>
      </div>

      {!migrationReady && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          Migração pendente: aplique <code>0005_charges.sql</code> no SQL Editor
          do Supabase para habilitar as cobranças.
        </p>
      )}
      {!mpReady && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          Mercado Pago não configurado — defina <code>MP_ACCESS_TOKEN</code> no .env
          e reinicie o servidor para gerar Pix.
        </p>
      )}
      {mpReady && !webhookReady && (
        <p className="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">
          Webhook não configurado (<code>MP_WEBHOOK_TOKEN</code>): defina no .env,
          reinicie e cadastre a URL em Suas integrações → Webhooks (evento
          Order) no painel do MP. Sem isso, os pagamentos precisam ser
          confirmados manualmente por aqui.
        </p>
      )}
      {mpReady && webhookReady && !signatureReady && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          Assinatura do webhook ausente (<code>MP_WEBHOOK_SECRET</code>): as
          notificações continuam sendo aceitas sem validar o <code>x-signature</code>.
          Recomendado definir no .env e reiniciar.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={search} className="flex min-w-56 flex-1 items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por cliente ou código"
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="outline">
            Buscar
          </Button>
          {q && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setQuery("");
                router.replace(buildHref("", status, 1));
              }}
            >
              Limpar
            </Button>
          )}
        </form>

        <Select value={status} onValueChange={changeStatus}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {CHARGE_STATUSES.map((item) => (
              <SelectItem key={item} value={item}>
                {CHARGE_STATUS_LABELS[item]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead className="hidden md:table-cell">Lotes</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden lg:table-cell">Criada</TableHead>
              <TableHead className="hidden lg:table-cell">Pago em</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((charge) => {
              const active = isChargeActive(charge);
              const open = isChargeOpen(charge.status);
              const lotCodes = charge.lots?.map((lot) => lot.code).join(", ") ?? "";

              return (
                <TableRow key={charge.id}>
                  <TableCell className="font-mono text-xs">{charge.code}</TableCell>
                  <TableCell>
                    <Link
                      href={`/admin/clientes/${charge.customer_id}`}
                      className="font-medium hover:underline"
                    >
                      {charge.customer?.name ?? "Sem nome"}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {charge.customer ? formatPhoneBR(charge.customer.phone_e164) : ""}
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                    <span title={lotCodes}>
                      {charge.lots?.length ?? 0}
                      {lotCodes ? ` · ${lotCodes}` : ""}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-medium">
                    {formatBRL(charge.amount)}
                  </TableCell>
                  <TableCell>
                    <ChargeStatusBadge status={charge.status} />
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                    <DateBR time value={charge.created_at} />
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                    <DateBR time value={charge.paid_at} fallback="—" />
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Ações da cobrança ${charge.code}`}
                          disabled={busyId === charge.id}
                        >
                          {busyId === charge.id ? (
                            <Loader2 className="animate-spin" />
                          ) : (
                            <MoreHorizontal />
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openQr(charge)}>
                          <QrCode />
                          {active ? "Ver QR / WhatsApp" : "Ver detalhes"}
                        </DropdownMenuItem>
                        {active && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => runSync(charge)}>
                              <RefreshCw />
                              Sincronizar com o Mercado Pago
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => runAction(charge, "paid")}>
                              <Check />
                              Marcar como pago
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => runAction(charge, "cancel")}>
                              <Ban />
                              Cancelar cobrança
                            </DropdownMenuItem>
                          </>
                        )}
                        {!active && open && (
                          <>
                            <DropdownMenuItem onClick={() => runSync(charge)}>
                              <RefreshCw />
                              Sincronizar com o Mercado Pago
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => runAction(charge, "cancel")}>
                              <Ban />
                              Cancelar cobrança
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}

            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center">
                  <span className="text-muted-foreground">
                    {q || status !== "all"
                      ? "Nenhuma cobrança corresponde aos filtros."
                      : "Nenhuma cobrança ainda."}
                  </span>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {total > pageSize && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Página {page} de {pages} · {total} cobranças
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Button asChild variant="outline" size="sm">
                <Link href={buildHref(q, status, page - 1)}>
                  <ChevronLeft />
                  Anterior
                </Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled>
                <ChevronLeft />
                Anterior
              </Button>
            )}
            {page < pages ? (
              <Button asChild variant="outline" size="sm">
                <Link href={buildHref(q, status, page + 1)}>
                  Próxima
                  <ChevronRight />
                </Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled>
                Próxima
                <ChevronRight />
              </Button>
            )}
          </div>
        </div>
      )}

      <ChargeFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        onCreated={(charge) => {
          setFormOpen(false);
          setQrCharge(charge);
        }}
      />

      <ChargeQrSheet
        charge={qrCharge}
        open={qrCharge !== null}
        onOpenChange={(open) => {
          if (!open) setQrCharge(null);
        }}
        paymentTemplate={paymentTemplate}
      />
    </div>
  );
}
