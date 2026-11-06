"use client";

import { unifiedShipmentRows, shipmentListSummary } from "@/lib/shipment-list";
import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import {
  cancelShipmentAction,
  getShippingNoticeAction,
  logShippingNotice,
  payShipmentAction,
  printShipmentAction,
  syncShipmentAction,
  ensureWebhookAction,
  releaseExternalPrizeFreight,
} from "@/app/actions/shipments";
import { ShipmentDetailSheet } from "@/components/admin/shipments/shipment-detail-sheet";
import { ShipmentFormSheet } from "@/components/admin/shipments/shipment-form-sheet";
import { ShipmentStatusBadge } from "@/components/admin/shipments/shipment-status-badge";
import type { ShipmentCostSummary } from "@/lib/shipments";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  canCancelShipment,
  canPayShipment,
  type Shipment,
} from "@/lib/shipments";
import { LOT_STATUS_LABELS, type LotStatus } from "@/lib/lots";
import type { ShipmentQueueRow } from "@/lib/shipments-server";

type Props = {
  rows: Shipment[];
  total: number;
  page: number;
  pageSize: number;
  q: string;
  status: string;
  priceChanges?: string;
  summary?: ShipmentCostSummary | null;
  historyDateFiltered?: boolean;
  /** Busca por cliente no histórico atingiu o teto de ids. */
  qTruncated?: boolean;
  /** Fila leu mais lotes no período do que o teto permite. */
  queueTruncated?: boolean;
  /** Fila por cliente (dia de envio ligado) ou histórico de envios (null). */
  queue: ShipmentQueueRow[] | null;
  /** Dia de envio da fila (YYYY-MM-DD, SP). */
  date: string;
  migrationReady: boolean;
  migrationFile?: string;
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
  priceChanges = "all",
  summary: serverSummary = null,
  historyDateFiltered = false,
  qTruncated,
  queueTruncated,
  queue,
  date,
  migrationReady,
  migrationFile = "0006_shipments.sql",
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
  const [emitTarget, setEmitTarget] = useState<ShipmentQueueRow | null>(null);
  const [detail, setDetail] = useState<Shipment | null>(null);
  const [activatingWebhook, setActivatingWebhook] = useState(false);
  const [freightFilter, setFreightFilter] = useState("all");
  const [queueStatus, setQueueStatus] = useState(status);
  const [costFilter, setCostFilter] = useState(priceChanges);
  const [listPage, setListPage] = useState(1);
  const [queueSort, setQueueSort] = useState("name");
  const allRows = unifiedShipmentRows(queue ?? [], rows);
  const displayedQueue = allRows.filter(row => {
    const freightMatches = freightFilter === "all" || (freightFilter === "unpaid" ? !row.companyFreight && ["due", "awaiting"].includes(row.freightStatus) : freightFilter === "company" ? row.companyFreight : !row.companyFreight && row.freightStatus === freightFilter);
    const shipmentMatches = queueStatus === "all" || (queueStatus === "unissued" ? !row.pendingShipment : row.pendingShipment?.status === queueStatus);
    const delta = Number(row.pendingShipment?.price_difference ?? 0);
    const costMatches = costFilter === "all" || (!!row.pendingShipment && (costFilter === "changed" ? delta !== 0 : costFilter === "increase" ? delta > 0 : delta < 0));
    return freightMatches && shipmentMatches && costMatches;
  }).sort((a, b) => {
    const unpaid = (row: ShipmentQueueRow) => !row.companyFreight && ["due", "awaiting"].includes(row.freightStatus) ? 1 : 0;
    const primary = queueSort === "unpaid" ? unpaid(b) - unpaid(a) : queueSort === "paid_total" ? b.paidTotal - a.paidTotal : queueSort === "unpaid_total" ? b.unpaidTotal - a.unpaidTotal : 0;
    return primary || (a.name ?? a.phone_e164).localeCompare(b.name ?? b.phone_e164, "pt-BR") || a.customerId.localeCompare(b.customerId);
  });

  const summary = shipmentListSummary(displayedQueue);
  const pages = Math.max(1, Math.ceil(displayedQueue.length / 20));
  const visiblePage = Math.min(listPage, pages);
  const visibleRows = displayedQueue.slice((visiblePage - 1) * 20, visiblePage * 20);
  void serverSummary; void pageSize; void page;
  const canCreate = migrationReady && originReady && superfreteReady;
  const isQueue = queue !== null;

  const buildHref = (
    nextQuery: string,
    nextStatus: string,
    nextPage: number,
    nextDate: string,
    nextView: "fila" | "historico",
    nextCost = priceChanges,
    nextHistoryDate = isQueue || historyDateFiltered ? nextDate : "",
  ) => {
    const params = new URLSearchParams();
    if (nextQuery.trim()) params.set("q", nextQuery.trim());
    if (nextView === "historico") {
      params.set("vista", "historico");
      if (nextHistoryDate) params.set("d", nextHistoryDate);
      if (nextCost !== "all") params.set("cost", nextCost);
      if (nextStatus !== "all") params.set("status", nextStatus);
      if (nextPage > 1) params.set("p", String(nextPage));
    } else {
      params.set("d", nextDate);
      if (nextCost !== "all") params.set("cost", nextCost);
      if (nextStatus !== "all") params.set("status", nextStatus);
      if (nextPage > 1) params.set("p", String(nextPage));
    }
    const search = params.toString();
    return `/admin/envios${search ? `?${search}` : ""}`;
  };

  const search = (event: FormEvent) => {
    event.preventDefault();
    router.replace(buildHref(query, queueStatus, 1, date, "fila", costFilter));
  };

  const setDay = (nextDate: string) => {
    router.replace(buildHref(query, queueStatus, 1, nextDate, "fila", costFilter, nextDate));
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

  /** Status do frete de uma linha da fila. */
  const freightLabel = (row: ShipmentQueueRow) => {
    const label = row.companyFreight ? "Frete por conta da empresa (prêmio)" : row.freightStatus === "paid" ? "Frete pago" : row.freightStatus === "awaiting" ? "Frete aguardando" : row.freightStatus === "due" ? "Frete pendente" : "Sem frete";
    return label;
  };
  const releaseFreight=(row:ShipmentQueueRow)=>{
    const ids=row.lots.filter(l=>l.arremate_value===0&&['paid','pending_payment'].includes(l.status)).map(l=>l.id);
    const reason=window.prompt('Motivo da liberação do frete dos prêmios de R$ 0:', 'Prêmio da rifa.digital — frete por conta da empresa');
    if(reason===null)return;
    startTransition(async()=>{const result=await releaseExternalPrizeFreight(row.customerId,ids,reason);if(!result.ok)toast.error(result.error);else{toast.success('Frete liberado para os prêmios selecionados.');router.refresh();}});
  };

  const notify = (shipment: Shipment) => {
    const popup=window.open("about:blank","_blank");if(popup)popup.opener=null;
    setBusyId(shipment.id);
    startTransition(async () => {
      try {
        const result = await getShippingNoticeAction(shipment.id);
        if (!result.ok) {
          popup?.close();
          toast.error(result.error ?? "Falha ao montar o aviso.");
          return;
        }
        const logged = await logShippingNotice(
          shipment.id,
          result.data.text,
          result.data.link,
        );
        if(popup)popup.location.href=result.data.link;else window.open(result.data.link,"_blank","noopener");
        router.refresh();
        if (!logged.ok) {
          toast.info(`Aviso aberto, mas o registro falhou: ${logged.error}`);
        }
      } catch (error) {
        popup?.close();
        toast.error(error instanceof Error ? error.message : "Erro inesperado.");
      } finally {
        setBusyId(null);
      }
    });
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
            {isQueue
              ? displayedQueue.length === 0
                ? "Nenhum cliente no período selecionado."
                : `${displayedQueue.length} ${displayedQueue.length === 1 ? "cliente" : "clientes"} no período.`
              : total === 0
                ? "Nenhum envio ainda — agrupe os lotes pagos e emita a etiqueta."
                : `${total} ${total === 1 ? "envio" : "envios"} no total.`}
          </p>
          {qTruncated && !isQueue && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              A busca por cliente passou de 300 correspondências — refine o
              termo para enxergar todas.
            </p>
          )}
          {queueTruncated && isQueue && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              Período muito movimentado: mostramos só os primeiros 1.000
              lotes — estreite as datas para ver o resto.
            </p>
          )}
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
                  ? `Aplique a migração ${migrationFile}.`
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
          Migração pendente: aplique <code>{migrationFile}</code> no SQL
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
            Webhook SuperFrete não ativado: sem ele, postagem, entrega e
            cancelamento feito direto na SuperFrete só aparecem após sincronizar
            manualmente.
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

      {migrationReady && <section aria-label="Resumo das etiquetas" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border bg-card p-4"><p className="text-xs font-medium text-muted-foreground">Etiquetas {isQueue || historyDateFiltered ? `de ${formatDateBR(date)}` : "do histórico filtrado"}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{summary?.labels ?? "—"}</p><p className="mt-1 text-xs text-muted-foreground">{summary ? `${summary.cancelled} cancelada(s) fora dos totais` : "Resumo indisponível. Confira a migration 0057."}</p></div>
        <div className="rounded-xl border bg-card p-4"><p className="text-xs font-medium text-muted-foreground">Total dos valores de emissão</p><p className="mt-2 text-2xl font-semibold tabular-nums">{summary ? formatBRL(summary.emissionTotal) : "—"}</p><p className="mt-1 text-xs text-muted-foreground">Custo das etiquetas, separado do frete cobrado do cliente. {summary?.legacyPrices ? `${summary.legacyPrices} etiqueta(s) antiga(s) usam o primeiro valor disponível.` : ""}{summary?.unknownPrices ? ` ${summary.unknownPrices} etiqueta(s) sem valor informado.` : ""}</p></div>
        <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Total atualizado</p><p className="mt-2 text-2xl font-semibold">{summary?.currentTotal != null ? formatBRL(summary.currentTotal) : "—"}</p><p className="text-xs text-muted-foreground">Inclui ajustes após postagem, sem canceladas.</p></div>
        <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Ajustes após postagem</p><p className="mt-2 text-2xl font-semibold">{summary?.adjustmentTotal != null ? formatBRL(summary.adjustmentTotal) : "—"}</p><p className="text-xs text-muted-foreground">{summary?.changedLabels ?? "—"} etiqueta(s) com alteração.</p></div>
        <div className="sm:col-span-2 xl:col-span-4">{isQueue && <Button asChild variant="outline" size="sm"><Link href={buildHref(query, "all", 1, date, "fila", "all")} onClick={()=>{setQueueStatus("all");setCostFilter("all");setFreightFilter("all");setListPage(1);}}>Ver todas as etiquetas</Link></Button>}<p className="mt-2 text-xs text-muted-foreground">Todas as etiquetas da data e dos filtros selecionados, incluindo postadas e entregues. Totais de todas as páginas.</p>{summary && summary.currentTotal == null && <p>Aplique a migration 0060 para carregar os totais atualizados.</p>}</div>
      </section>}
      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={search} className="flex w-full min-w-0 flex-1 items-center gap-2 sm:min-w-56">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por cliente, código ou rastreio"
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
                router.replace(buildHref("", status, 1, date, isQueue ? "fila" : "historico"));
              }}
            >
              Limpar
            </Button>
          )}
        </form>

        {(
          <Input
            type="date"
            value={isQueue || historyDateFiltered ? date : ""}
            onChange={(event) => {
              const value = event.target.value;
              if (/^\d{4}-\d{2}-\d{2}$/.test(value)) setDay(value);
            }}
            className="w-40"
            aria-label="Dia do envio"
          />
        )}
        {!isQueue && historyDateFiltered && <Button variant="ghost" size="sm" onClick={() => router.replace(buildHref(query, status, 1, "", "historico", priceChanges, ""))}>Todas as datas</Button>}




      </div>


      {isQueue && <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="grid min-w-0 gap-1.5 text-xs font-medium">Pagamento do frete<select aria-label="Pagamento do frete" className="h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm" value={freightFilter} onChange={e => setFreightFilter(e.target.value)}><option value="all">Todos os fretes</option><option value="unpaid">Fretes não pagos</option><option value="due">Fretes pendentes</option><option value="awaiting">Aguardando confirmação</option><option value="paid">Fretes pagos</option><option value="company">Por conta da empresa</option></select></label>
        <label className="grid min-w-0 gap-1.5 text-xs font-medium">Situação do envio<select aria-label="Situação do envio na fila" className="h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm" value={queueStatus} onChange={e => setQueueStatus(e.target.value)}><option value="all">Todas as situações</option><option value="unissued">Não emitidos</option><option value="pending">Etiqueta pendente</option><option value="released">Aguardando postagem</option><option value="posted">Postados</option><option value="delivered">Entregues</option><option value="cancelled">Cancelados</option></select></label>
        <label className="grid min-w-0 gap-1.5 text-xs font-medium">Ordenar por<select aria-label="Ordenar fila de envios" className="h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm" value={queueSort} onChange={e => setQueueSort(e.target.value)}><option value="name">Cliente · A a Z</option><option value="unpaid">Fretes não pagos primeiro</option><option value="paid_total">Maior total pago em lotes</option><option value="unpaid_total">Maior valor de lotes não pagos</option></select></label>
        <label className="grid min-w-0 gap-1.5 text-xs font-medium">Alteração de valor<select aria-label="Alteração de custo" className="h-10 rounded-md border bg-background px-3 text-sm" value={costFilter} onChange={e=>{setCostFilter(e.target.value);setListPage(1);}}><option value="all">Todos os valores</option><option value="changed">Com alteração</option><option value="increase">Aumento</option><option value="decrease">Redução</option></select></label>
        {(freightFilter !== "all" || queueStatus !== "all" || queueSort !== "name" || costFilter !== "all") && <Button variant="ghost" size="sm" className="w-fit" onClick={() => { setFreightFilter("all"); setQueueStatus("all"); setQueueSort("name"); setCostFilter("all"); setListPage(1); }}>Limpar filtros</Button>}
        <p className="text-xs text-muted-foreground sm:col-span-2 xl:col-span-4">Exibindo {displayedQueue.length} de {allRows.length} registros da data selecionada.</p>
      </div>}

      {isQueue && (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader className="max-lg:hidden">
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Lotes</TableHead>
                <TableHead>Total pago</TableHead>
                <TableHead className="hidden md:table-cell">Não pago</TableHead>
                <TableHead className="hidden md:table-cell">Envio</TableHead>
                <TableHead>Frete</TableHead>
                <TableHead>Custo atual</TableHead>
                <TableHead className="w-44">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((row) => {
                const shipment = row.pendingShipment;
                const byStatus = row.lots.reduce<Record<string, number>>((acc, lot) => {
                  acc[lot.status] = (acc[lot.status] ?? 0) + 1;
                  return acc;
                }, {});

                return (
                  <TableRow key={shipment?.id ?? `customer-${row.customerId}`} className="max-lg:grid max-lg:grid-cols-2 max-lg:gap-x-2 max-lg:p-2 max-lg:[&>td]:min-w-0 max-lg:[&>td]:whitespace-normal max-lg:[&>td]:before:mb-1 max-lg:[&>td]:before:block max-lg:[&>td]:before:text-[10px] max-lg:[&>td]:before:font-medium max-lg:[&>td]:before:text-muted-foreground max-lg:[&>td]:before:content-[attr(data-label)]">
                    <TableCell data-label="Cliente" className="max-lg:col-span-2">
                      <Link
                        href={`/admin/clientes/${row.customerId}`}
                        className="font-medium hover:underline"
                      >
                        {row.name ?? "Sem nome"}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {formatPhoneBR(row.phone_e164)}{(row.storeOrderCount??0)>0&&<span className="block text-ouro-ink">{row.storeOrderCount} pedido(s) da loja</span>}{(row.raffleAwardCount??0)>0&&<span className="block text-ouro-ink">{row.raffleAwardCount} prêmio(s) de rifa</span>}
                      </span>
                    </TableCell>
                    <TableCell data-label="Lotes" className="text-sm text-muted-foreground">
                      <TooltipProvider delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="cursor-help text-left font-medium text-foreground"
                            >
                              {row.lots.length}{" "}
                              {row.lots.length === 1 ? "lote" : "lotes"}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-64">
                            <span className="block whitespace-normal font-mono leading-relaxed">
                              {row.lots.map((lot) => lot.code).join(", ")}
                            </span>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      {Object.entries(byStatus).map(([statusKey, count]) => (
                        <span
                          key={statusKey}
                          className="block text-xs text-muted-foreground"
                        >
                          {count}× {LOT_STATUS_LABELS[statusKey as LotStatus]}
                        </span>
                      ))}
                    </TableCell>
                    <TableCell data-label="Total pago" className="whitespace-nowrap font-medium">
                      {row.labelOnly ? "—" : formatBRL(row.paidTotal)}
                    </TableCell>
                    <TableCell data-label="Não pago" className="whitespace-nowrap text-sm text-muted-foreground">
                      {row.unpaidTotal > 0 ? formatBRL(row.unpaidTotal) : "—"}
                    </TableCell>
                    <TableCell data-label="Data prevista" className="whitespace-nowrap text-muted-foreground">
                      {row.shippingDate ? formatDateBR(row.shippingDate) : "—"}
                    </TableCell>
                    <TableCell data-label="Frete" className="whitespace-nowrap text-sm">
                      {shipment ? <><ShipmentStatusBadge status={shipment.status} /><span className="block">{freightLabel(row)}</span></> : <>Não emitido · {freightLabel(row)}</>}
                      {shipment?.tracking_code && (
                        <span className="block font-mono text-xs text-muted-foreground">
                          {shipment.tracking_code}
                        </span>
                      )}
                    </TableCell>
                    <TableCell data-label="Emissão" className="whitespace-nowrap text-sm font-medium">
                      {shipment ? formatBRL(shipment.price ?? shipment.original_price ?? null) : "—"}
                      {shipment?.price_baseline_legacy && <span className="block text-[10px] font-normal text-muted-foreground">Primeiro valor registrado</span>}
                      {!!shipment?.price_change_count && <span className="block text-[11px] text-amber-700 dark:text-amber-400">Original: {formatBRL(shipment.original_price ?? null)} · {formatBRL(shipment.price_difference ?? 0)}</span>}
                    </TableCell>
                    <TableCell data-label="Ações" className="max-lg:col-span-2">
                      {shipment ? (
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => notify(shipment)}
                            disabled={busyId === shipment.id || !["released","posted","delivered"].includes(shipment.status)}
                          >
                            {busyId === shipment.id ? (
                              <Loader2 className="animate-spin" />
                            ) : null}
                            Enviar ao cliente
                          </Button>
                          <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Ações do envio ${shipment.code}`}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={()=>setDetail(shipment)}>Ver detalhes</DropdownMenuItem>
                            {shipment.status !== "cancelled" && <DropdownMenuItem onClick={()=>sync(shipment)}>Sincronizar</DropdownMenuItem>}
                            <DropdownMenuItem onClick={()=>print(shipment)}>Etiqueta PDF</DropdownMenuItem>
                            {canPayShipment(shipment.status) && <DropdownMenuItem onClick={()=>pay(shipment)}>Pagar etiqueta</DropdownMenuItem>}
                            {canCancelShipment(shipment.status) && <DropdownMenuItem onClick={()=>cancel(shipment)}>Cancelar envio</DropdownMenuItem>}
                          </DropdownMenuContent></DropdownMenu>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1"><Button
                          size="sm"
                          disabled={!canCreate || (row.blockingUnpaidTotal ?? row.unpaidTotal) > 0 || row.hasActiveCharge || (!row.companyFreight && row.freightStatus !== "paid")}
                          onClick={() => setEmitTarget(row)}
                          title={
                            (row.blockingUnpaidTotal ?? row.unpaidTotal) > 0
                              ? "Há lotes pendentes de pagamento para este cliente."
                              : row.hasActiveCharge
                                ? "O cliente tem uma cobrança aguardando pagamento."
                              : (!row.companyFreight && row.freightStatus !== "paid")
                                ? "O frete de todos os períodos dos lotes precisa estar pago."
                                : canCreate
                                  ? undefined
                                  : !migrationReady
                                    ? "Aplique a migração 0006_shipments.sql."
                                    : !originReady
                                      ? "Preencha o endereço de origem em Configuração."
                                      : "Configure SUPERFRETE_TOKEN no .env."
                          }
                        >
                          Emitir envio
                        </Button>
                        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Opções de envio de ${row.name??'cliente'}`}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem disabled={!row.lots.some(l=>l.arremate_value===0&&['paid','pending_payment'].includes(l.status))} onClick={()=>releaseFreight(row)}>Liberar frete</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}

              {displayedQueue.length === 0 && (
                <TableRow>
                    <TableCell colSpan={8} className="h-32 text-center">
                    <span className="text-muted-foreground">
                      {q ? "Nenhum cliente corresponde à busca." : "Nenhum envio corresponde aos filtros."}
                    </span>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{displayedQueue.length} resultado(s) · Página {visiblePage} de {pages}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={visiblePage===1} onClick={()=>setListPage(visiblePage-1)}>Anterior</Button><Button variant="outline" size="sm" disabled={visiblePage===pages} onClick={()=>setListPage(visiblePage+1)}>Próxima</Button></div></div>
      <ShipmentFormSheet
        open={formOpen}
        title="Novo envio"
        onOpenChange={setFormOpen}
        onCreated={(shipment) => {
          setFormOpen(false);
          setDetail(shipment);
          router.refresh();
        }}
      />

      {emitTarget && (
        <ShipmentFormSheet
          open
          title="Emitir envio"
          initialCustomer={{
            id: emitTarget.customerId,
            name: emitTarget.name,
            phone_e164: emitTarget.phone_e164,
          }}
          onOpenChange={(open) => {
            if (!open) setEmitTarget(null);
          }}
          onCreated={(shipment) => {
            setEmitTarget(null);
            setDetail(shipment);
            router.refresh();
          }}
        />
      )}

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
