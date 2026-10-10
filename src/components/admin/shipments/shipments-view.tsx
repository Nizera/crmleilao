"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Ban,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import {
  cancelShipmentAction,
  payShipmentAction,
  printShipmentAction,
  syncShipmentAction,
  ensureWebhookAction,
} from "@/app/actions/shipments";
import { ShipmentDetailSheet } from "@/components/admin/shipments/shipment-detail-sheet";
import { ShipmentFormSheet } from "@/components/admin/shipments/shipment-form-sheet";
import { ShipmentStatusBadge } from "@/components/admin/shipments/shipment-status-badge";
import { Button } from "@/components/ui/button";
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
import { formatPhoneBR } from "@/lib/customers";
import { formatDateBR, formatBRL } from "@/lib/lots";
import {
  SHIPMENT_STATUSES,
  SHIPMENT_STATUS_LABELS,
  canCancelShipment,
  canPayShipment,
  type Shipment,
} from "@/lib/shipments";

type Props = {
  rows: Shipment[];
  total: number;
  page: number;
  pageSize: number;
  q: string;
  status: string;
  migrationReady: boolean;
  originReady: boolean;
  superfreteReady: boolean;
  sandbox: boolean;
  webhookActive: boolean;
};

export function ShipmentsView({
  rows,
  total,
  page,
  pageSize,
  q,
  status,
  migrationReady,
  originReady,
  superfreteReady,
  sandbox,
  webhookActive,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState(q);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [detail, setDetail] = useState<Shipment | null>(null);
  const [activatingWebhook, setActivatingWebhook] = useState(false);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const canCreate = migrationReady && originReady && superfreteReady;

  const buildHref = (nextQuery: string, nextStatus: string, nextPage: number) => {
    const params = new URLSearchParams();
    if (nextQuery.trim()) params.set("q", nextQuery.trim());
    if (nextStatus !== "all") params.set("status", nextStatus);
    if (nextPage > 1) params.set("p", String(nextPage));
    const search = params.toString();
    return `/admin/envios${search ? `?${search}` : ""}`;
  };

  const search = (event: FormEvent) => {
    event.preventDefault();
    router.replace(buildHref(query, status, 1));
  };

  const updateDetail = (shipment: Shipment) => {
    setDetail(shipment);
  };

  const run = (
    shipment: Shipment,
    task: () => Promise<{ ok: boolean; error?: string; data?: Shipment }>,
    successMessage?: string,
  ) => {
    setBusyId(shipment.id);
    startTransition(async () => {
      try {
        const result = await task();
        if (!result.ok) {
          toast.error(result.error ?? "Falha na operação.");
          return;
        }
        if (result.data) updateDetail(result.data);
        if (successMessage) toast.success(successMessage);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Erro inesperado.");
      } finally {
        setBusyId(null);
      }
    });
  };

  const sync = (shipment: Shipment) =>
    run(
      shipment,
      async () => {
        const result = await syncShipmentAction(shipment.id);
        return result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error };
      },
      "Status sincronizado com a SuperFrete.",
    );

  const pay = (shipment: Shipment) => {
    const label = shipment.price != null ? ` (${formatBRL(shipment.price)})` : "";
    if (!window.confirm(`Pagar a etiqueta de ${shipment.code}${label} com o saldo da carteira?`)) return;
    run(
      shipment,
      async () => {
        const result = await payShipmentAction(shipment.id);
        return result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error };
      },
      "Etiqueta paga.",
    );
  };

  const print = (shipment: Shipment) =>
    run(shipment, async () => {
      const result = await printShipmentAction(shipment.id);
      if (!result.ok) return { ok: false, error: result.error };
      window.open(result.data.url, "_blank", "noopener");
      return { ok: true };
    });

  const cancel = (shipment: Shipment) => {
    if (!window.confirm(`Cancelar o envio ${shipment.code}? A etiqueta é estornada e os lotes voltam a Pago.`)) return;
    run(
      shipment,
      async () => {
        const result = await cancelShipmentAction(shipment.id);
        return result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error };
      },
      "Envio cancelado.",
    );
  };

  const activateWebhook = () => {
    setActivatingWebhook(true);
    startTransition(async () => {
      try {
        const result = await ensureWebhookAction();
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success(
          result.data.created
            ? "Webhook ativado na SuperFrete."
            : "Webhook já estava ativo.",
        );
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Erro inesperado.");
      } finally {
        setActivatingWebhook(false);
      }
    });
  };

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:gap-8 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Envios</h2>
          <p className="text-sm text-muted-foreground">
            {total === 0
              ? "Nenhum envio ainda — agrupe os lotes pagos e emita a etiqueta."
              : `${total} ${total === 1 ? "envio" : "envios"} no total.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {sandbox && (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
              sandbox SuperFrete
            </span>
          )}
          <Button
            onClick={() => setFormOpen(true)}
            disabled={!canCreate}
            title={
              canCreate
                ? undefined
                : !migrationReady
                  ? "Aplique a migração 0006_shipments.sql."
                  : !originReady
                    ? "Preencha o endereço de origem em Configuração."
                    : "Configure SUPERFRETE_TOKEN no .env."
            }
          >
            <Plus />
            Novo envio
          </Button>
        </div>
      </div>

      {!migrationReady && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          Migração pendente: aplique <code>0006_shipments.sql</code> no SQL
          Editor do Supabase para habilitar os envios.
        </p>
      )}
      {migrationReady && !superfreteReady && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          SuperFrete não configurada — defina <code>SUPERFRETE_TOKEN</code> no
          .env e reinicie o servidor.
        </p>
      )}
      {migrationReady && superfreteReady && !originReady && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          Endereço de origem incompleto — preencha em{" "}
          <Link href="/admin/configuracao" className="underline">
            Configuração
          </Link>{" "}
          para poder cotar e emitir.
        </p>
      )}
      {migrationReady && superfreteReady && originReady && !webhookActive && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">
          <span>
            Webhook SuperFrete não ativado: sem ele, postagem e entrega só
            atualizam quando você sincronizar manualmente.
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={activateWebhook}
            disabled={activatingWebhook}
          >
            {activatingWebhook && <Loader2 className="animate-spin" />}
            Ativar webhook
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={search} className="flex min-w-56 flex-1 items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por código, rastreio ou cliente"
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

        <Select
          value={status}
          onValueChange={(value) => router.replace(buildHref(query, value, 1))}
        >
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {SHIPMENT_STATUSES.map((item) => (
              <SelectItem key={item} value={item}>
                {SHIPMENT_STATUS_LABELS[item]}
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
              <TableHead className="hidden lg:table-cell">Transportadora</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead className="hidden lg:table-cell">Rastreio</TableHead>
              <TableHead className="hidden md:table-cell">Envio</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((shipment) => {
              const lotCodes =
                shipment.lots?.map((lot) => lot.code).join(", ") ?? "";
              const finalPrice =
                shipment.price != null
                  ? Number(shipment.price) - Number(shipment.discount ?? 0)
                  : null;

              return (
                <TableRow key={shipment.id}>
                  <TableCell className="font-mono text-xs">
                    {shipment.code}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/admin/clientes/${shipment.customer_id}`}
                      className="font-medium hover:underline"
                    >
                      {shipment.customer?.name ?? "Sem nome"}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {shipment.customer
                        ? formatPhoneBR(shipment.customer.phone_e164)
                        : ""}
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                    <span title={lotCodes}>
                      {shipment.lots?.length ?? 0}
                      {lotCodes ? ` · ${lotCodes}` : ""}
                    </span>
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground lg:table-cell">
                    {shipment.carrier ?? shipment.service_name ?? "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-medium">
                    {finalPrice != null ? formatBRL(finalPrice) : "—"}
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap font-mono text-xs lg:table-cell">
                    {shipment.tracking_code ?? "—"}
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">
                    {formatDateBR(shipment.batch_date)}
                  </TableCell>
                  <TableCell>
                    <ShipmentStatusBadge status={shipment.status} />
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Ações do envio ${shipment.code}`}
                          disabled={busyId === shipment.id}
                        >
                          {busyId === shipment.id ? (
                            <Loader2 className="animate-spin" />
                          ) : (
                            <MoreHorizontal />
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setDetail(shipment)}>
                          <ExternalLink />
                          Ver detalhes
                        </DropdownMenuItem>
                        {shipment.status !== "cancelled" && (
                          <DropdownMenuItem onClick={() => sync(shipment)}>
                            <RefreshCw />
                            Sincronizar
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => print(shipment)}>
                          <Printer />
                          Etiqueta PDF
                        </DropdownMenuItem>
                        {canPayShipment(shipment.status) && (
                          <DropdownMenuItem onClick={() => pay(shipment)}>
                            <Wallet />
                            Pagar etiqueta
                          </DropdownMenuItem>
                        )}
                        {canCancelShipment(shipment.status) && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => cancel(shipment)}>
                              <Ban />
                              Cancelar envio
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
                <TableCell colSpan={9} className="h-32 text-center">
                  <span className="text-muted-foreground">
                    {q || status !== "all"
                      ? "Nenhum envio corresponde aos filtros."
                      : "Nenhum envio ainda."}
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
            Página {page} de {pages} · {total} envios
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

      <ShipmentFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        onCreated={(shipment) => {
          setFormOpen(false);
          setDetail(shipment);
          router.refresh();
        }}
      />

      <ShipmentDetailSheet
        shipment={detail}
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        onUpdate={updateDetail}
      />
    </div>
  );
}
