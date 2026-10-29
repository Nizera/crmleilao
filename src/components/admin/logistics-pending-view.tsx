"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { createLogisticsPendingAction, handleLogisticsPendingAction } from "@/app/actions/logistics-pending";
import { searchShipmentCustomers } from "@/app/actions/shipments";
import type { Customer } from "@/lib/dal";
import { LOGISTICS_STATES, type LogisticsPending } from "@/lib/logistics-pending";
import { formatDateBR } from "@/lib/lots";
import { spDayOf, spTimeOf } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

type Props = { rows: LogisticsPending[]; total: number; page: number; q: string; status: string; canWrite: boolean; migrationMissing: boolean; defaultDate: string };

export function LogisticsPendingView({ rows, total, page, q, status, canWrite, migrationMissing, defaultDate }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(q);
  const [customerQuery, setCustomerQuery] = useState("");
  const [matches, setMatches] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const href = (nextPage: number, nextStatus = status, nextQuery = query) => {
    const params = new URLSearchParams();
    if (nextQuery.trim()) params.set("q", nextQuery.trim());
    if (nextStatus !== "active") params.set("status", nextStatus);
    if (nextPage > 1) params.set("p", String(nextPage));
    return `/admin/pendencias?${params}`;
  };
  const handle = (id: string, action: string, day?: string) => startTransition(async () => {
    const result = await handleLogisticsPendingAction(id, action, day);
    if (!result.ok) return void toast.error(result.error);
    toast.success(action === "box" ? "Pendência colocada na caixa do cliente." : "Pendência atualizada.");
    router.refresh();
  });
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!customer) return void toast.error("Selecione um cliente.");
    const form = new FormData(event.currentTarget);
    form.set("customer_id", customer.id);
    startTransition(async () => {
      const result = await createLogisticsPendingAction(form);
      if (!result.ok) return void toast.error(result.error);
      toast.success("Pendência registrada sem cobrança.");
      setOpen(false); setCustomer(null); setMatches([]); setCustomerQuery("");
      router.refresh();
    });
  };

  return <div className="flex min-w-0 flex-1 flex-col gap-5 p-4 md:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-xl font-semibold">Pendências logísticas</h2>
        <p className="text-sm text-muted-foreground">Reposições de itens que faltaram no pacote do cliente. {total} registro(s) neste filtro.</p></div>
      <Button disabled={!canWrite} onClick={() => setOpen(true)}><Plus />Nova pendência</Button>
    </div>
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
      Sem cobrança: não gera Pix, Caracoins, novo frete ou faturamento. Separe os itens no relatório e coloque na caixa do cliente para seguir no próximo envio com seus lotes.
      <p className="mt-1 text-muted-foreground">Os itens são conferidos manualmente e não descontam estoque automaticamente. “Na caixa” ainda não significa enviado.</p>
    </div>
    {migrationMissing && <p role="alert" className="rounded-md border p-4 text-sm">Aplique a migration 0035_logistics_pending.sql para liberar esta área.</p>}
    <div className="flex min-w-0 flex-wrap gap-2">
      <form className="flex min-w-0 flex-1 basis-64 gap-2" onSubmit={event => { event.preventDefault(); router.replace(href(1)); }}>
        <Input aria-label="Buscar pendências" placeholder="Cliente, telefone, código ou item" value={query} onChange={event => setQuery(event.target.value)} className="min-w-0" />
        <Button variant="outline" type="submit"><Search className="size-4" /><span className="sr-only sm:not-sr-only">Buscar</span></Button>
      </form>
      <select aria-label="Situação da pendência" className="h-9 max-w-full rounded-md border bg-background px-3 text-sm" value={status} onChange={event => router.replace(href(1, event.target.value))}>
        <option value="active">Em andamento</option><option value="all">Todas as situações</option>
        {Object.entries(LOGISTICS_STATES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <Button asChild variant="outline"><Link href="/admin/relatorios">Abrir separação</Link></Button>
    </div>
    {!rows.length && <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhuma pendência neste filtro.</p>}
    <div className="grid min-w-0 gap-3 xl:grid-cols-2">
      {rows.map(row => <article key={row.id} className="min-w-0 space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><div>
          <p className="font-semibold">{row.customer_name ?? "Sem nome"}</p><p className="text-xs text-muted-foreground">{row.phone_e164}</p>
        </div><span className="rounded-md border px-2 py-1 text-xs">{LOGISTICS_STATES[row.state]}</span></div>
        <p className="break-words font-medium">{row.quantity} × {row.title}</p>
        <p className="whitespace-pre-wrap break-words text-sm"><span className="font-medium">Motivo:</span> {row.reason}</p>
        <p className="text-xs text-muted-foreground">{row.code} · Cadastro: {formatDateBR(spDayOf(row.created_at))} às {spTimeOf(row.created_at)}<br />Envio previsto: {formatDateBR(row.shipping_date)} · Sem cobrança</p>
        {row.shipment_id && <p className="text-sm">Envio {row.shipment_code}{row.tracking_code ? ` · Rastreio: ${row.tracking_code}` : " · Aguardando rastreio"}</p>}
        {canWrite && !row.shipment_id && row.state !== "cancelled" && <div className="space-y-3 border-t pt-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={pending} onClick={() => handle(row.id, row.moved_at ? "reopen" : "box")}>{row.moved_at ? "Voltar para separação" : "Colocar na caixa"}</Button>
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => { if (window.confirm("Cancelar esta pendência? Ela deixará a fila de separação, mantendo o histórico.")) handle(row.id, "cancel"); }}>Cancelar pendência</Button>
          </div>
          <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); handle(row.id, "reschedule", String(new FormData(event.currentTarget).get("day"))); }}>
            <label className="text-xs">Reagendar envio<Input className="mt-1 w-40" type="date" name="day" defaultValue={row.shipping_date} required disabled={pending} /></label>
            <Button type="submit" variant="outline" size="sm" disabled={pending}>Reagendar</Button>
          </form>
        </div>}
      </article>)}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><span>Página {page} · {total} registro(s)</span><div className="flex gap-2">
      {page > 1 && <Button asChild variant="outline"><Link href={href(page - 1)}>Anterior</Link></Button>}
      {page * 25 < total && <Button asChild variant="outline"><Link href={href(page + 1)}>Próxima</Link></Button>}
    </div></div>
    <Sheet open={open} onOpenChange={value => { if (!pending) setOpen(value); }}><SheetContent className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
      <SheetHeader><SheetTitle>Nova pendência logística</SheetTitle><SheetDescription>Registre o que faltou enviar. Nenhum valor será cobrado do cliente.</SheetDescription></SheetHeader>
      <div className="space-y-4 px-4 pb-6">
        <form className="space-y-2" onSubmit={event => { event.preventDefault(); startTransition(async () => {
          const result = await searchShipmentCustomers(customerQuery);
          if (!result.ok) return void toast.error(result.error);
          setMatches(result.data);
          if (!result.data.length) toast.info("Nenhum cliente encontrado. Cadastre o cliente na tela Clientes.");
        }); }}>
          <label className="text-sm font-medium" htmlFor="pending-customer">Cliente</label>
          <div className="flex gap-2"><Input id="pending-customer" placeholder="Buscar por nome ou WhatsApp" minLength={2} required value={customerQuery} onChange={event => setCustomerQuery(event.target.value)} /><Button variant="outline" disabled={pending} type="submit">Buscar</Button></div>
          {matches.map(item => <Button key={item.id} type="button" variant={customer?.id === item.id ? "secondary" : "ghost"} className="h-auto w-full justify-start whitespace-normal text-left" onClick={() => { setCustomer(item); setMatches([]); }}>{item.name ?? "Sem nome"} · {item.phone_e164}</Button>)}
          {customer && <p className="rounded border p-2 text-sm">Selecionado: {customer.name ?? "Sem nome"} · {customer.phone_e164}</p>}
        </form>
        <form onSubmit={save} className="space-y-4">
          <label className="block space-y-1 text-sm">Item / figurinhas<Input name="title" maxLength={160} required placeholder="Ex.: Messi bronze que faltou no pacote" /></label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">Quantidade<Input name="quantity" type="number" min={1} max={999} defaultValue={1} required /></label>
            <label className="min-w-0 space-y-1 text-sm">Envio previsto<Input name="shipping_date" type="date" defaultValue={defaultDate} required /></label>
          </div>
          <label className="block space-y-1 text-sm">Motivo / instrução para separação<Textarea name="reason" maxLength={2000} required placeholder="Ex.: não foi no último pacote. Repor no próximo envio." /></label>
          <Button type="submit" disabled={pending || !customer || !canWrite}>{pending ? "Salvando…" : "Registrar sem cobrança"}</Button>
        </form>
      </div>
    </SheetContent></Sheet>
  </div>;
}
