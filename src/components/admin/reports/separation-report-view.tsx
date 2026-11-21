"use client";

import {filterReportCustomers} from "@/lib/report-search";
import { useEffect, useRef, useState, useTransition } from "react";
import {filterReportMovement, type ReportMovementFilter} from "@/lib/report-movement";
import { toast } from "sonner";
import { Eye, LoaderCircle } from "lucide-react";
import { getLotDetailAction } from "@/app/actions/lots";
import { ImageLightbox } from "@/components/client/image-lightbox";

import { getSeparationReportAction, moveReportItemsToBoxesAction } from "@/app/actions/reports";
import { handleStoreOrderAction } from "@/app/actions/store";
import { boxRaffleAward } from "@/app/actions/raffles";
import { handleLogisticsPendingAction } from "@/app/actions/logistics-pending";
import { PrintButton } from "@/components/admin/reports/print-button";
import { Button } from "@/components/ui/button";
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
import { formatDateBR, lotImageUrl, LOT_STATUS_LABELS } from "@/lib/lots";
import type { SeparationAddress, SeparationReport } from "@/lib/reports-server";
import { WEEKDAY_LABELS_FULL } from "@/lib/settings";
import { isoDayAdd, spDayOf, spTimeOf } from "@/lib/dates";

const ALL = "all";
const UNMOVED = "unmoved";
const MOVED = "moved";

function lotRegistrationLabel(createdAt: string): string {
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) return "";
  const day = spDayOf(createdAt);
  const time = spTimeOf(createdAt);
  const hour = Number(time.slice(0, 2));
  const period = hour >= 6 && hour < 12 ? "Manhã" : hour >= 12 && hour < 18 ? "Tarde" : "Noite";
  const auctionDay = hour < 6 ? isoDayAdd(day, -1) : day;
  return `Cadastro: ${formatDateBR(day)} às ${time} · ${period}${auctionDay !== day ? ` de ${formatDateBR(auctionDay)}` : ""}`;
}

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

function shippingLabel(day?: string): string {
  if (!day) return "";
  const overdue = day < spDayOf(new Date().toISOString());
  return `Envio previsto: ${formatDateBR(day)}${overdue ? " · Data prevista já passou" : ""}`;
}

function movementLabel(movedAt?: string | null, dispatched = false): string {
  if (movedAt) return `Movimentado em ${formatDateBR(spDayOf(movedAt))} às ${spTimeOf(movedAt)}${dispatched ? " · Já enviado" : ""}`;
  return dispatched ? "Já enviado · Sem registro de separação" : "Não movimentado · A separar";
}

type Props = {
  initialDate: string;
  initialReport: SeparationReport;
};

export function SeparationReportView({ initialDate, initialReport }: Props) {
  const [storeDeclared,setStoreDeclared]=useState<Record<string,string>>({});
  const [date, setDate] = useState(initialDate);
  const [specificDate, setSpecificDate] = useState(initialDate === ALL ? spDayOf(new Date().toISOString()) : initialDate);
  const [report, setReport] = useState(initialReport);
  const [customerId, setCustomerId] = useState(ALL);
  const [search,setSearch] = useState("");
  const [movementFilter, setMovementFilter] = useState<ReportMovementFilter>(UNMOVED);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [gallery, setGallery] = useState<{ src: string; alt: string }[]>([]);
  const [imageIndex, setImageIndex] = useState<number | null>(null);
  const [loadingImages, setLoadingImages] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const busy = useRef(false);
  useEffect(() => { busy.current = isPending; }, [isPending]);

  // A report left open by SAC must reload movements saved by another operator.
  useEffect(() => {
    let disposed = false;
    let refreshing = false;
    const refresh = () => {
      if (disposed || refreshing || busy.current || document.visibilityState === "hidden" || !navigator.onLine) return;
      refreshing = true;
      startTransition(async () => {
        try {
          const result = await getSeparationReportAction(date);
          if (disposed) return;
          if (result.ok) { setReport(result.data); setSelectedIds([]); }
          else toast.error(result.error);
        } catch {
          // A suspended phone, failed request or old deployment must not unmount the report.
          // Keep current data and let the next focus/interval retry this read-only operation.
        } finally {
          refreshing = false;
        }
      });
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const interval = window.setInterval(refresh, 60_000);
    return () => {
      disposed = true;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(interval);
    };
  }, [date]);

  const openImages = async (id: string) => {
    if (loadingImages) return;
    setLoadingImages(id);
    try {
      const result = await getLotDetailAction(id);
      if (!result.ok) { toast.error(result.error); return; }
      const lot = result.data;
      const images = (lot.images ?? []).map(path => lotImageUrl(path)).filter((url): url is string => Boolean(url));
      if (!images.length) { toast.info("Este lote não possui imagens cadastradas."); return; }
      setGallery(images.map((src, index) => ({ src, alt: `Lote ${lot.code} · ${lot.title} · Foto ${index + 1}` })));
      setImageIndex(0);
    } catch {
      toast.error("Não foi possível carregar as imagens. Tente novamente.");
    } finally {
      setLoadingImages(null);
    }
  };

  // Empty results must never silently broaden a selected customer to everyone.
  const selectedId = customerId;
  const movementCustomers = filterReportMovement(report.customers, date, movementFilter, selectedId);

  const customers = filterReportCustomers(movementCustomers,search);
  const lotsCount = customers.reduce((sum, c) => sum + c.lots.length, 0);
  const visibleIds = new Set(customers.flatMap(customer => [...customer.lots.filter(lot => lot.status === "paid" && !lot.movedAt && !lot.dispatched).map(lot => lot.id), ...(customer.logisticsPending ?? []).filter(issue => !issue.moved_at && !issue.dispatched).map(issue => `issue:${issue.id}`)]));
  const selectedVisibleIds = selectedIds.filter((id) => visibleIds.has(id));

  const changeDate = (value: string) => {
    if (!value) return;
    setSelectedIds([]);
    startTransition(async () => {
      const result = await getSeparationReportAction(value);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setDate(value);
      if (value !== ALL) setSpecificDate(value);
      setReport(result.data);
    });
  };

  const refreshMovement = (value: ReportMovementFilter = movementFilter) => {
    setSelectedIds([]);
    startTransition(async () => {
      const result = await getSeparationReportAction(date);
      if (!result.ok) { toast.error(result.error); return; }
      setReport(result.data);
      setMovementFilter(value);
    });
  };

  const moveSelected = () => {
    const ids = [...selectedVisibleIds];
    if (!ids.length) return;
    startTransition(async () => {
      const result = await moveReportItemsToBoxesAction({ lotIds: ids.filter(id => !id.startsWith("issue:")), issueIds: ids.filter(id => id.startsWith("issue:")).map(id => id.slice(6)) });
      if (!result.ok) {
        toast.error(result.error);
        const refreshed = await getSeparationReportAction(date);
        if (refreshed.ok) { setReport(refreshed.data); setSelectedIds([]); }
        return;
      }
      toast.success(`${result.data.moved} item(ns) movimentado(s) para a caixa do cliente.`);
      setSelectedIds([]);
      const refreshed = await getSeparationReportAction(date);
      if (refreshed.ok) setReport(refreshed.data);
      else toast.error(refreshed.error);
    });
  };

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:gap-8 md:p-6 print:gap-0 print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Relatórios</h2>
          <p className="text-sm text-muted-foreground">
            Separação de arremates, produtos da loja e pendências logísticas por dia de envio.
          </p>
        </div>
        <div className="flex gap-2"><Button variant="outline" disabled={isPending} onClick={() => refreshMovement()}>Atualizar relatório</Button><PrintButton variant="outline" disabled={isPending || customers.length === 0} /></div>
      </div>

      {(report.warnings ?? []).map(warning => <p key={warning} role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-200 print:text-black">{warning}</p>)}

      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <Field className="w-full">
          <FieldLabel htmlFor="report-search">Pesquisar no relatório</FieldLabel>
          <div className="flex min-w-0 gap-2">
            <Input id="report-search" className="min-w-0 flex-1" type="search" value={search} maxLength={160} onChange={event=>{setSearch(event.target.value);setSelectedIds([]);}} placeholder="Cliente, código, jogador, card ou descrição…" disabled={isPending} />
            {search && <Button type="button" variant="outline" onClick={()=>{setSearch("");setSelectedIds([]);}}>Limpar busca</Button>}
          </div>
        </Field>
        <Field className="w-full sm:w-48">
          <FieldLabel>Período de envio</FieldLabel>
          <Select value={date === ALL ? ALL : "date"} onValueChange={value => changeDate(value === ALL ? ALL : specificDate)} disabled={isPending}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="date">Uma data específica</SelectItem><SelectItem value={ALL}>Todas as datas</SelectItem></SelectContent>
          </Select>
        </Field>
        {date !== ALL && <Field className="w-full sm:w-44">
          <FieldLabel htmlFor="separation-date">Data de envio</FieldLabel>
          <Input
            id="separation-date"
            type="date"
            value={date}
            onChange={(event) => changeDate(event.target.value)}
            disabled={isPending}
          />
        </Field>}

        <Field className="w-full sm:w-64">
          <FieldLabel>Cliente</FieldLabel>
          <Select
            value={selectedId}
            onValueChange={value => { setCustomerId(value); refreshMovement(); }}
            disabled={isPending}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Cliente" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>
                Todos os clientes ({report.customers.length})
              </SelectItem>
              {customerId !== ALL && !report.customers.some(customer => customer.customerId === customerId) && <SelectItem value={customerId}>Cliente selecionado · Sem itens nesta data</SelectItem>}
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

        <Field className="w-48">
          <FieldLabel>Movimentação</FieldLabel>
          <Select value={movementFilter} onValueChange={value => refreshMovement(value as ReportMovementFilter)} disabled={isPending}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={UNMOVED}>Não movimentados</SelectItem>
              <SelectItem value={MOVED}>Movimentados</SelectItem>
              <SelectItem value={ALL}>Todos</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <p className="pb-2 text-sm text-muted-foreground">
          Lotes pagos aparecem para separação mesmo quando o cliente tem outros pagamentos pendentes. Os lotes pendentes não aparecem nesta lista. Confira os pagamentos e o frete antes de emitir o envio.
        </p>
        {report.totals.excludedCustomers > 0 && (
          <p className="pb-2 text-sm text-amber-700 dark:text-amber-300">
            {report.totals.excludedCustomers} cliente(s) sem itens elegíveis nesta data por pagamento ou frete pendente. Reposições gratuitas continuam disponíveis para conferência.
          </p>
        )}
        {visibleIds.size > 0 && <Button type="button" variant="outline" disabled={isPending} className="mb-1" onClick={() => { setSelectedIds([...visibleIds].slice(0,100)); if (visibleIds.size > 100) toast.info("Selecionados os primeiros 100 itens visíveis. Movimente este grupo antes dos demais."); }}>Selecionar itens visíveis</Button>}
        {selectedVisibleIds.length > 0 && <Button type="button" variant="ghost" disabled={isPending} className="mb-1" onClick={() => setSelectedIds([])}>Limpar seleção</Button>}
        {selectedVisibleIds.length > 100 && <p role="alert" className="text-xs text-destructive">Selecione no máximo 100 itens por movimentação.</p>}
        {selectedVisibleIds.length > 0 && (
          <Button type="button" onClick={moveSelected} disabled={isPending || selectedVisibleIds.length > 100} className="mb-1">
            Movimentar {selectedVisibleIds.length} item(ns)
          </Button>
        )}

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
              Os Caras das Legends · Separação
            </p>
            <h3 className="text-lg font-semibold">
              {report.shippingDate === ALL ? "Todas as datas" : formatDateBR(report.shippingDate)}
              <span className="ml-2 font-normal text-muted-foreground">
                {report.shippingDate === ALL ? "" : weekdayOf(report.shippingDate)}
              </span>
            </h3>
            <p className="text-sm font-medium">{movementFilter === UNMOVED ? "Não movimentados" : movementFilter === MOVED ? "Movimentados / já enviados" : "Todos os estados de movimentação"}</p>
          </div>
          <p className="text-sm text-muted-foreground">
            {customers.length} {customers.length === 1 ? "cliente" : "clientes"}{" "}
            · {lotsCount} {lotsCount === 1 ? "lote" : "lotes"}
            {" · "}{customers.reduce((sum, customer) => sum + customer.logisticsPending.length, 0)} pendência(s)
          </p>
        </header>

        {customers.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Nenhum item encontrado com os filtros selecionados para o período: {" "}
            {report.shippingDate === ALL ? "Todas as datas" : formatDateBR(report.shippingDate)}.
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

                {customer.hasPendingPayment && <p className="mb-3 rounded-md border border-amber-500/40 bg-amber-50 p-3 text-xs font-medium text-amber-950 dark:bg-amber-950/20 dark:text-amber-200 print:bg-transparent print:text-black">Cliente com pagamentos pendentes para este envio. Os lotes pagos continuam visíveis para separação; os pendentes não estão nesta lista. Confira antes de enviar.</p>}
                {customer.storeOrders.map(order => <div key={order.id} className="mb-3 rounded-md border border-ouro/40 p-3 break-inside-avoid">
                  <p className="text-sm font-semibold">Loja · {order.code} {"· " + movementLabel(order.boxed_at, order.dispatched)}</p>
                  {date === ALL && <p className="mt-1 text-xs text-muted-foreground">{shippingLabel(order.shippingDate)}</p>}
                  <ul className="mt-2 grid gap-1 text-xs">{order.items.filter(item=>item.delivery_kind==='physical').map((item,index)=><li key={index}>{item.quantity}× {item.name}</li>)}</ul>
                  {!order.dispatched && order.fulfillment_status==='processing' && !order.boxed_at && <label className="mt-3 grid gap-1 text-xs print:hidden">Valor declarado em reais (obrigatório para produtos em Caracoins)<input type="number" min="0.01" max="100000" step="0.01" value={storeDeclared[order.id]??''} onChange={event=>setStoreDeclared(values=>({...values,[order.id]:event.target.value}))} placeholder="Em reais, automático; em Caracoins, informe o valor" className="h-9 max-w-sm rounded-md border bg-background px-2"/></label>}
                  {!order.dispatched && !order.boxed_at && <Button size="sm" variant="outline" disabled={isPending} className="mt-3 print:hidden" onClick={()=>startTransition(async()=>{
                    const form=new FormData(); form.set('order_id',order.id); form.set('status',order.fulfillment_status==='awaiting'?'processing':'boxed');form.set('declared_value',storeDeclared[order.id]??'');
                    const result=await handleStoreOrderAction(form);
                    if(!result.ok){toast.error(result.error);return;}
                    const refreshed=await getSeparationReportAction(date);if(refreshed.ok)setReport(refreshed.data);else toast.error(refreshed.error);
                  })}>{order.fulfillment_status==='awaiting'?'Iniciar separação':'Colocar na caixa do cliente'}</Button>}
                </div>)}
                {customer.logisticsPending.map(issue => <div key={issue.id} className="mb-3 rounded-md border border-amber-500/40 p-3 break-inside-avoid">
                  <p className="flex items-center gap-2 text-sm font-semibold">{!issue.moved_at && !issue.dispatched && <input type="checkbox" aria-label={`Selecionar ${issue.source_kind === "raffle" ? "prêmio" : "pendência"} ${issue.code} para movimentação`} checked={selectedIds.includes(`issue:${issue.id}`)} disabled={isPending} onChange={event => setSelectedIds(current => event.target.checked ? [...new Set([...current, `issue:${issue.id}`])] : current.filter(id => id !== `issue:${issue.id}`))} className="size-4 shrink-0 print:hidden" />}{issue.source_kind === "raffle" ? "Prêmio de rifa" : "Pendência logística — sem cobrança"} · {issue.code}</p>
                  {date === ALL && <p className="mt-1 text-xs text-muted-foreground">{shippingLabel(issue.shippingDate)}</p>}
                  <p className="mt-1 break-words text-sm">{issue.quantity} × {issue.title}</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-xs">Motivo: {issue.reason}</p>
                  <p className="mt-1 text-xs">{movementLabel(issue.moved_at, issue.dispatched)}{issue.shipmentCode ? ` · Envio ${issue.shipmentCode}` : ""}</p>
                  {!issue.moved_at && !issue.dispatched && <Button variant="outline" size="sm" className="mt-2 print:hidden" disabled={isPending} onClick={() => startTransition(async () => {
                    const result = issue.source_kind === "raffle" ? await boxRaffleAward(issue.id, Number(issue.shipping_declared_value ?? 0)) : await handleLogisticsPendingAction(issue.id, "box");
                    if (!result.ok) { toast.error(result.error); return; }
                    const refreshed = await getSeparationReportAction(date);
                    if (refreshed.ok) setReport(refreshed.data); else toast.error(refreshed.error);
                  })}>Colocar na caixa do cliente</Button>}
                </div>)}
                {customer.lots.map((lot) => (
                  <div
                    key={lot.id}
                    className="mb-3 overflow-hidden rounded-md border break-inside-avoid last:mb-0"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 bg-muted/40 px-3 py-1.5 print:bg-transparent">
                      <p className="flex min-w-0 flex-1 items-center gap-2 break-words text-sm">
                        {lot.movedAt || lot.dispatched ? (
                          <span className="rounded border px-1.5 py-0.5 text-[10px] ">{lot.movedAt ? "Movimentado" : "Já enviado"}</span>
                        ) : (
                          <input type="checkbox" aria-label={`Selecionar lote ${lot.code} para movimentação`} checked={selectedIds.includes(lot.id)} disabled={isPending || lot.status !== "paid"} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, lot.id] : current.filter((id) => id !== lot.id))} className="size-4 shrink-0 print:hidden" />
                        )}
                        <span className="hidden size-3.5 shrink-0 border border-black print:block" />
                        <span className="font-mono font-semibold">
                          {lot.code}
                        </span>
                        <span className="text-muted-foreground/60">·</span>
                        <span className="min-w-0 break-words">{lot.title}</span>
                      </p>
                      <div className="flex shrink-0 items-center gap-2">
                      <p className="text-xs text-muted-foreground">
                        {LOT_STATUS_LABELS[lot.status]}
                      </p>
                      <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0 print:hidden" aria-label={`Ver imagens do lote ${lot.code}`} title="Ver imagens" disabled={loadingImages !== null} onClick={() => void openImages(lot.id)}>
                        {loadingImages === lot.id ? <LoaderCircle className="size-4 animate-spin" /> : <Eye className="size-4" />}
                      </Button>
                      </div>
                    </div>
                    {date === ALL && <p className="px-3 py-1 text-xs text-muted-foreground">{shippingLabel(lot.shippingDate)}</p>}
                    <p className="px-3 py-1 text-xs font-medium">{movementLabel(lot.movedAt, lot.dispatched)}</p>
                    {lot.createdAt && <p className="border-t px-3 py-1.5 text-[11px] leading-relaxed text-muted-foreground print:text-black">{lotRegistrationLabel(lot.createdAt)}</p>}
                    {(lot.movedItems.length > 0 || lot.description?.trim() || lot.notes?.trim()) && (
                      <div className="grid gap-1 px-3 py-2 text-xs print:text-black">
                        {lot.movedItems.length > 0 ? (
                          <p className="whitespace-pre-wrap break-words"><span className="font-semibold">Movimentado:</span> {lot.movedItems.join(", ")}</p>
                        ) : lot.description?.trim() ? (
                          <p className="whitespace-pre-wrap break-words">
                            <span className="font-semibold">Descrição:</span>{" "}
                            {lot.description}
                          </p>
                        ) : null}
                        {lot.notes?.trim() && (
                          <p className="whitespace-pre-wrap break-words">
                            <span className="font-semibold">Observação:</span>{" "}
                            {lot.notes}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                <p className="text-right text-xs text-muted-foreground">
                  {customer.lots.length}{" "}
                  {customer.lots.length === 1 ? "lote" : "lotes"}
                  {" · "}{customer.logisticsPending.length} pendência(s)
                </p>
              </section>
            );
          })
        )}
      </div>
      <div className="print:hidden"><ImageLightbox images={gallery} index={imageIndex} onOpenChange={setImageIndex} /></div>
    </div>
  );
}
