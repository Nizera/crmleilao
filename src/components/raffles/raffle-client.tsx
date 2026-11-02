"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Gift, Ticket, CheckCircle2, Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { reserveRaffle, refreshRaffleOrder, refreshRaffleOrders } from "@/app/actions/raffles";
import { quotaLabel, raffleMoney, raffleStatus, type Raffle, type RaffleOrder, type RaffleAward } from "@/lib/raffles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { raffleReservationDeadline } from "@/lib/raffle-reservation";
import { usePaymentExpired } from "@/components/client/use-payment-expired";

export type RaffleDetail = { campaign: Raffle; paid: number; reserved: number; results: { title: string; number: number; note: string; evidence: string; status: string }[]; prizes: { id: string; title: string; kind: string; number: number | null; found: boolean }[]; numbers: { number: number; state: string }[] };
export function RaffleParticipation({ detail: d, from, enabled }: { detail: RaffleDetail; from: number; enabled: boolean }) {
  const c = d.campaign; const router = useRouter();
  const [automatic, setAutomatic] = useState(c.selection_mode === "automatic");
  const [selected, setSelected] = useState<number[]>([]); const [quantity, setQuantity] = useState(c.min_quantity);
  const [pending, start] = useTransition(); const requestKey = useRef<string | null>(null);
  const qty = automatic ? quantity : selected.length;
  const valid = qty >= c.min_quantity && qty <= c.max_quantity;
  const toggle = (n: number) => { requestKey.current = null; setSelected(current => current.includes(n) ? current.filter(v => v !== n) : current.length < c.max_quantity ? [...current, n] : current); };
  return <div className="grid min-w-0 gap-5">
    <section className="overflow-hidden rounded-2xl border bg-card"><div className="flex aspect-[16/10] max-h-80 items-center justify-center bg-muted">{c.image_url ? <picture><img src={c.image_url} alt={c.title} className="size-full object-contain" referrerPolicy="no-referrer" /></picture> : <Gift className="size-20 text-ouro-ink" />}</div><div className="grid gap-3 p-5"><p className="text-xs font-semibold text-ouro-ink">{raffleStatus[c.status]}</p><h1 className="text-2xl font-bold">{c.title}</h1><p className="text-2xl font-bold text-ouro-ink">{raffleMoney(c.unit_price)} <span className="text-sm font-normal text-muted-foreground">por cota</span></p><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, d.paid / c.total_numbers * 100)}%` }} /></div><p className="text-xs text-muted-foreground">{d.paid} pagas · {d.reserved} reservadas · {c.total_numbers - d.paid - d.reserved} disponíveis</p></div></section>
    <details className="rounded-xl border p-4"><summary className="cursor-pointer font-semibold">Regulamento e apuração</summary><p className="mt-3 whitespace-pre-wrap text-sm">{c.description}</p><p className="mt-4 text-sm font-bold">{c.draw_method === "federal" ? "Loteria Federal" : "Sorteador externo"}</p><p className="mt-2 whitespace-pre-wrap text-sm">{c.draw_rules}</p></details>
    {d.results?.length > 0 && <section className="grid gap-3 rounded-xl border border-ouro/40 p-4"><h2 className="font-bold">Resultado do sorteio</h2>{d.results.map((r, i) => <div key={i} className="grid gap-2 rounded-lg bg-muted p-3 text-sm"><strong>{r.title} · Cota {quotaLabel(r.number, c.total_numbers)}</strong><p className="whitespace-pre-wrap">{r.note}</p>{r.status === "review" && <p>Resultado em análise pela equipe.</p>}{r.evidence?.startsWith("https://") && <a className="underline" href={r.evidence} target="_blank" rel="noopener noreferrer">Conferir comprovante do resultado</a>}</div>)}</section>}
    <section className="grid gap-3 rounded-xl border p-4"><h2 className="flex items-center gap-2 font-bold"><Gift className="size-5 text-ouro-ink" />Prêmios da campanha</h2>{d.prizes.map(p => <div key={p.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-muted p-3 text-sm"><span>{p.title}</span><span className="font-semibold">{p.kind === "main" ? "Sorteio principal" : p.found ? "Cota premiada encontrada" : p.number !== null ? `Cota ${quotaLabel(p.number, c.total_numbers)}` : "Cota surpresa"}</span></div>)}<p className="text-xs text-muted-foreground">Cotas premiadas são reveladas após a confirmação do pagamento. Os prêmios ficam disponíveis em Meus prêmios.</p></section>
    <section className="grid gap-4 rounded-xl border p-4"><h2 className="text-lg font-bold">Escolha suas cotas</h2>{c.selection_mode === "both" && <div className="grid grid-cols-2 gap-2"><Button className="h-auto min-h-11 min-w-0 whitespace-normal px-2 py-2" variant={automatic ? "outline" : "default"} onClick={() => { setAutomatic(false); requestKey.current = null; }}>Escolher números</Button><Button className="h-auto min-h-11 min-w-0 whitespace-normal px-2 py-2" variant={automatic ? "default" : "outline"} onClick={() => { setAutomatic(true); requestKey.current = null; }}>Receber aleatórios</Button></div>}
      {automatic ? <label className="grid gap-2 text-sm">Quantidade<Input type="number" min={c.min_quantity} max={c.max_quantity} value={quantity} onChange={e => { setQuantity(Number(e.target.value)); requestKey.current = null; }} /><span className="text-xs text-muted-foreground">Os números são atribuídos no momento da reserva.</span></label> : <><form className="flex gap-2" action={`/painel/rifas/${c.id}`}><label className="sr-only" htmlFor="quota-search">Buscar cota</label><Input id="quota-search" type="number" name="from" min={0} max={c.total_numbers - 1} placeholder="Buscar número" /><Button variant="outline">Buscar</Button></form><div className="flex flex-wrap gap-3 text-xs"><span>○ Disponível</span><span className="text-ouro-ink">● Selecionada</span><span className="text-muted-foreground">● Paga ou reservada</span></div><div className="grid grid-cols-5 gap-2 sm:grid-cols-10">{d.numbers.map(n => <button type="button" key={n.number} aria-pressed={selected.includes(n.number)} disabled={pending || n.state !== "available" || c.status !== "open"} onClick={() => toggle(n.number)} className={`min-h-10 rounded-lg border px-1 text-xs font-semibold tabular-nums disabled:cursor-not-allowed disabled:opacity-40 ${selected.includes(n.number) ? "border-amarelo bg-amarelo text-black" : "bg-background"}`} title={n.state === "available" ? "Disponível" : n.state === "paid" ? "Paga" : "Reservada"}>{quotaLabel(n.number, c.total_numbers)}</button>)}</div><div className="flex flex-wrap items-center justify-between gap-2 text-sm"><Button asChild variant="outline" disabled={from === 0}><Link aria-disabled={from === 0} href={`?from=${Math.max(0, from - 100)}`}>Anterior</Link></Button><span>{quotaLabel(from, c.total_numbers)}–{quotaLabel(Math.min(from + 99, c.total_numbers - 1), c.total_numbers)}</span><Button asChild variant="outline" disabled={from + 100 >= c.total_numbers}><Link aria-disabled={from + 100 >= c.total_numbers} href={`?from=${Math.min(c.total_numbers - 1, from + 100)}`}>Próximas</Link></Button></div>{selected.length > 0 && <p className="break-words text-xs text-muted-foreground">Selecionadas: {selected.map(n => quotaLabel(n, c.total_numbers)).join(", ")}</p>}</>}
      <p className="text-xs text-muted-foreground">Entre {c.min_quantity} e {c.max_quantity} cotas por compra. Reserva por 10 minutos. Uma reserva aberta por campanha. Compras não geram Caracoins nem alteram seu elo.</p>
      <div className="grid gap-3 rounded-xl bg-amarelo/10 p-4"><div className="flex flex-wrap justify-between gap-2"><span>{qty} cota(s)</span><strong>{raffleMoney(qty * c.unit_price)}</strong></div><Button className="h-auto min-h-10 whitespace-normal py-3" disabled={pending || !valid || c.status !== "open" || !enabled} onClick={() => start(async () => {
        requestKey.current ??= crypto.randomUUID();
        const r = await reserveRaffle({ campaign: c.id, key: requestKey.current, ...(automatic ? { quantity } : { numbers: selected }) });
        if (!r.ok) { toast.error(r.error); return; }
        router.push(`/painel/rifas?tab=orders&order=${r.data.id}`); router.refresh();
      })}><Ticket />{pending ? "Reservando…" : !enabled ? "Compras ainda não liberadas" : "Reservar e pagar com Pix"}</Button><p className="text-xs text-muted-foreground">Confira os números e o total antes de continuar. Sua participação será confirmada após o pagamento.</p></div>
    </section>
  </div>;
}

export function RaffleOrdersList({ orders, awards }: { orders: RaffleOrder[]; awards: RaffleAward[] }) {
  const router = useRouter();
  const busy = useRef(false);
  const cursor = useRef(0);
  const activeCount = orders.filter(o => ["creating", "pending"].includes(o.status)).length;
  useEffect(() => {
    if (!activeCount) return;
    let disposed = false;
    const sync = async () => {
      if (busy.current || document.visibilityState !== "visible") return;
      busy.current = true;
      try {
        const result = await refreshRaffleOrders(orders.map(o => o.id), cursor.current % Math.max(1, activeCount));
        cursor.current = (cursor.current + 3) % Math.max(1, activeCount);
        if (!disposed && result.ok && result.data.some(updated => {
          const previous = orders.find(o => o.id === updated.id);
          return previous && (previous.status !== updated.status || previous.qr_code !== updated.qr_code || previous.expires_at !== updated.expires_at || previous.reservation_expires_at !== updated.reservation_expires_at);
        })) router.refresh();
      } catch { /* Webhook e reconciliação seguem ativos; mantém as reservas. */ }
      finally { busy.current = false; }
    };
    void sync();
    const timer = setInterval(() => void sync(), 20000);
    document.addEventListener("visibilitychange", sync);
    return () => { disposed = true; clearInterval(timer); document.removeEventListener("visibilitychange", sync); };
  }, [activeCount, orders, router]);
  return <div className="grid gap-4">{orders.map(order => <RaffleOrderCard key={order.id} order={order} awards={awards} />)}</div>;
}

export function RaffleOrderCard({ order, awards }: { order: RaffleOrder; awards: RaffleAward[] }) {
  const [pix, setPix] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const active = ["creating", "pending"].includes(order.status);
  const reservationDeadline = raffleReservationDeadline(order);
  const expired = usePaymentExpired(reservationDeadline);
  const update = (cancel = false) => start(async () => {
    try {
      const result = await refreshRaffleOrder(order.id, cancel);
      if (!result.ok) { toast.error(result.error); return; }
      if (cancel && ["creating", "pending"].includes(result.data.status)) toast.info("Aguardando confirmação do cancelamento. Suas cotas continuam reservadas.");
      router.refresh();
    } catch { toast.error("Não foi possível conferir agora. Tente novamente em instantes."); }
  });
  return <article id={order.id} className="grid min-w-0 gap-3 rounded-xl border bg-card p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h2 className="break-words font-bold">{order.campaign_title || "Participação na rifa"}</h2><p className="mt-1 text-xs text-muted-foreground">{order.code} · {raffleStatus[order.status]}</p></div>
      <strong className="text-ouro-ink">{raffleMoney(order.amount)}</strong>
    </div>
    <p className="text-sm">{order.numbers.length} cota(s)</p>
    <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto">{order.numbers.map(n => <span key={n} className={`rounded-lg px-3 py-2 text-xs font-bold ${order.status === "paid" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted"}`}>{quotaLabel(n, order.total_numbers)}</span>)}</div>
    {order.status === "paid" && <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="size-4" />Pagamento confirmado. Boa sorte!</p>}
    {order.status === "paid" && awards.filter(a => a.order_id === order.id && !a.cancelled_at).map(a => <div role="status" key={a.id} className="rounded-xl border border-ouro/40 bg-amarelo/10 p-4"><p className="flex items-center gap-2 text-lg font-bold text-ouro-ink"><Gift className="size-6" />Você ganhou!</p><p className="mt-2 font-semibold">{a.title}</p><p className="mt-1 text-sm">Cota {quotaLabel(a.number, a.total_numbers)} · Já está vinculado ao seu cadastro.</p><Link className="mt-2 inline-block text-sm underline" href="/painel/rifas?tab=awards">Acompanhar meu prêmio</Link></div>)}
    {active && <>
      <p className="text-xs text-muted-foreground">{expired ? "Prazo encerrado; conferindo pagamento. As cotas continuam reservadas até a confirmação do Mercado Pago." : "Confirmação automática. Você pode sair e retomar esta reserva depois."}</p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} onClick={() => expired ? update() : setPix(!pix)}>{expired ? "Conferir pagamento" : pix ? "Fechar Pix" : "Pagar com Pix"}</Button>
        <Button variant="outline" disabled={pending} onClick={() => update()}><RefreshCw className={pending ? "animate-spin" : ""} />Atualizar</Button>
        <Button variant="ghost" disabled={pending} onClick={() => { if (confirm("Cancelar esta reserva? As cotas só serão liberadas após confirmação do Mercado Pago.")) update(true); }}>Cancelar reserva</Button>
      </div>
      {pix && !expired && <div className="grid gap-3 rounded-xl bg-muted p-4">
        {order.qr_code ? <>
          {order.qr_code_base64 && <Image src={`data:image/png;base64,${order.qr_code_base64}`} alt="QR Code do Pix da rifa" width={224} height={224} unoptimized className="mx-auto size-56 max-w-full rounded-lg bg-white p-2" />}
          <label className="grid gap-2 text-sm">Pix copia e cola<textarea value={order.qr_code} readOnly rows={4} className="w-full rounded-lg border bg-background p-3 text-xs" onFocus={e => e.target.select()} /></label>
          <Button onClick={async () => { try { await navigator.clipboard.writeText(order.qr_code!); toast.success("Pix copiado!"); } catch { toast.error("Selecione e copie o código acima."); } }}><Copy />Copiar Pix</Button>
        </> : <p className="text-sm">Preparando o Pix. Sua reserva já foi salva e será atualizada automaticamente.</p>}
        {reservationDeadline && <p className="text-xs">Reserva por 10 minutos. Prazo: {new Date(reservationDeadline).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p>}
      </div>}
    </>}
    {order.status === "review" && <p className="text-sm text-destructive">Pagamento em análise. Fale com a equipe antes de efetuar uma nova compra.</p>}
  </article>;
}
