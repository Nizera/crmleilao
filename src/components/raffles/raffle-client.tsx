"use client";
import { compareRafflePrizes, raffleDrawPrizeLabel } from "@/lib/raffle-prize-order";
import type { RaffleBuyer } from "@/lib/raffle-ranking-server";
import { RafflePhotos } from "@/components/raffles/raffle-photos";
import { useEffect, useReducer, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { commerceLoginHref, raffleIntentKey, raffleIntentSchema } from "@/lib/commerce-access";
import Link from "next/link";
import Image from "next/image";
import { Gift, Ticket, CheckCircle2, Copy, RefreshCw } from "lucide-react";
import { Clock3, Search, Trophy, ChevronRight, ArrowRight } from "lucide-react";
import { RaffleBadge, RaffleProgress } from "@/components/raffles/raffle-ui";
import { ImageLightbox } from "@/components/client/image-lightbox";
import { ReservationCountdown } from "@/components/raffles/reservation-countdown";
import { rafflePhotos } from "@/lib/raffle-photos";
import { toast } from "sonner";
import { reserveRaffle, refreshRaffleOrder, refreshRaffleOrders } from "@/app/actions/raffles";
import { quotaLabel, raffleMoney, raffleStatus, type Raffle, type RaffleOrder, type RaffleAward } from "@/lib/raffles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { raffleReservationDeadline } from "@/lib/raffle-reservation";
import { usePaymentExpired } from "@/components/client/use-payment-expired";

export type RaffleDetail = { campaign: Raffle; paid: number; reserved: number; results: { title: string; number: number; note: string; evidence: string; status: string }[]; prizes: { id: string; title: string; kind: string; number: number | null; found: boolean; image_urls?: string[] }[]; numbers: { number: number; state: string }[] };
type ParticipationSelection = { automatic:boolean; selected:number[]; quantity:number };
export function RaffleParticipation({ detail: d, from, enabled, guest=false, resume=false, buyers=null }: { buyers?: RaffleBuyer[] | null; detail: RaffleDetail; from: number; enabled: boolean; guest?:boolean; resume?:boolean }) {
  const c = d.campaign; const router = useRouter();
  const [selection,dispatchSelection]=useReducer((state:ParticipationSelection,patch:Partial<ParticipationSelection>|((current:ParticipationSelection)=>ParticipationSelection))=>typeof patch==="function"?patch(state):({...state,...patch}),{automatic:c.selection_mode==="automatic",selected:[],quantity:c.min_quantity});
  const {automatic,selected,quantity}=selection;
  const setAutomatic=(value:boolean)=>dispatchSelection({automatic:value});
  const setQuantity=(value:number)=>dispatchSelection({quantity:value});
  const setSelected=(value:number[]|((current:number[])=>number[]))=>dispatchSelection(state=>({...state,selected:typeof value==="function"?value(state.selected):value}));
  const [filter, setFilter] = useState("all"); const [photo, setPhoto] = useState<number | null>(null);
  const [pending, start] = useTransition(); const requestKey = useRef<string | null>(null);
  useEffect(() => {
    if (guest || !resume) return;
    try {
      const saved = raffleIntentSchema.safeParse(JSON.parse(sessionStorage.getItem(raffleIntentKey(c.id)) ?? "null"));
      if (!saved.success) return;
      const automaticMode = c.selection_mode === "automatic" || (c.selection_mode === "both" && saved.data.automatic);

      // Números de outras páginas serão revalidados pelo servidor ao confirmar.
      dispatchSelection({automatic:automaticMode,quantity:Math.max(c.min_quantity, Math.min(c.max_quantity, saved.data.quantity)),selected:[...new Set(saved.data.numbers)].filter(n => n < c.total_numbers && !d.numbers.some(row => row.number === n && row.state !== "available")).slice(0, c.max_quantity)});
      sessionStorage.removeItem(raffleIntentKey(c.id));
    } catch { /* Seleção local inválida: o cliente escolhe novamente. */ }
  }, [guest,resume,c.id,c.selection_mode,c.min_quantity,c.max_quantity,c.total_numbers,d.numbers]);
  const qty = automatic ? quantity : selected.length;
  const valid = Number.isInteger(qty) && qty >= c.min_quantity && qty <= c.max_quantity;
  const available = Math.max(0, c.total_numbers - d.paid - d.reserved);
  const images = rafflePhotos(c);
  const instant = d.prizes.filter(p => p.kind === "instant");
  useEffect(() => {
    if (!["open", "paused"].includes(c.status)) return;
    const timer=setInterval(()=>{if(document.visibilityState==="visible"&&!pending)router.refresh();},30000);
    return()=>clearInterval(timer);
  },[c.status,pending,router]);
  const visible = d.numbers.filter(n => filter === "all" || n.state === "available");
  const toggle = (n: number) => { requestKey.current = null; setSelected(current => current.includes(n) ? current.filter(v => v !== n) : current.length < c.max_quantity ? [...current, n] : current); };
  return <div className="rf-participation">
    <div className="rf-participation-side grid min-w-0 gap-4">
      <section className="rf-panel grid gap-5"><div className="flex items-start gap-4">
        {images[0] ? <button type="button" onClick={() => setPhoto(0)} aria-label={`Ampliar foto de ${c.title}`} className="aspect-[4/5] w-28 shrink-0 overflow-hidden rounded-xl border bg-muted sm:w-40"><picture><img src={images[0]} alt={c.title} className="size-full object-contain" referrerPolicy="no-referrer" /></picture></button> : <span className="rf-icon-tile"><Gift size={28} /></span>}
        <div className="grid min-w-0 content-start gap-3"><RaffleBadge status={c.status}>{d.paid >= c.total_numbers && c.status === "paused" ? "Aguardando apuração" : raffleStatus[c.status]}</RaffleBadge><h1 className="text-xl font-bold leading-tight tracking-tight sm:text-2xl">{c.title}</h1><p className="rf-campaign-price">{raffleMoney(c.unit_price)}<span className="mt-1 block text-xs font-normal text-muted-foreground">por cota</span></p>{images.length > 1 && <button type="button" onClick={() => setPhoto(0)} className="w-fit text-xs font-semibold text-ouro-ink underline">Ver {images.length} fotos</button>}</div>
      </div><RaffleProgress paid={d.paid} reserved={d.reserved} total={c.total_numbers} />{instant.length > 0 && <span className="rf-badge rf-badge-gold w-fit"><Gift size={13} />{instant.length} cotas premiadas · {instant.filter(p => p.found).length} encontradas</span>}</section>
      <section className="rf-panel grid gap-3" aria-label="Ranking de compradores">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Trophy size={17} className="text-ouro-ink"/>Maiores compradores</h2>
        <p className="rf-caption">Top 3 desta rifa · somente cotas pagas</p>
        {buyers === null ? <p className="rf-caption">Ranking indisponível no momento.</p> : buyers.length === 0 ? <p className="rf-caption">O ranking aparece após os primeiros pagamentos confirmados.</p> : <ol className="grid gap-2">{buyers.map(buyer => <li key={buyer.position} className="flex min-w-0 items-center gap-3 rounded-xl bg-muted/50 p-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ouro/15 text-xs font-bold text-ouro-ink">{buyer.position}º</span><span className="min-w-0 flex-1 break-words text-sm font-medium">{buyer.name}</span><strong className="shrink-0 text-xs tabular-nums">{buyer.quantity} {buyer.quantity === 1 ? "cota" : "cotas"}</strong></li>)}</ol>}
      </section>
      <details className="rf-panel"><summary className="cursor-pointer text-sm font-semibold">Prêmios e regulamento</summary><div className="mt-4 grid gap-4">{d.prizes.filter(p => p.kind === "main").sort(compareRafflePrizes).map(p => <div key={p.id} className="flex gap-3 rounded-xl bg-muted p-3"><Trophy size={18} className="shrink-0 text-ouro-ink" /><div><p className="text-xs text-muted-foreground">{raffleDrawPrizeLabel(p.title)}</p><p className="text-sm font-semibold">{p.title}</p></div></div>)}<p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{c.description}</p><div className="border-t pt-3"><h2 className="text-sm font-semibold">{c.draw_method === "federal" ? "Loteria Federal" : "Sorteador externo"}</h2><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{c.draw_rules}</p></div></div></details>
      {instant.length > 0 && <details className="rf-panel" open><summary className="cursor-pointer text-sm font-semibold">Cotas premiadas <span className="ml-1 text-ouro-ink">{instant.filter(p => p.found).length}/{instant.length}</span></summary><div className="mt-4 grid gap-2">{instant.map(p => <div key={p.id} data-found={p.found} className={`flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border p-3 ${p.found ? "border-dashed bg-muted/50" : "bg-background"}`}><div className="flex min-w-0 items-center gap-2"><Gift size={15} className="shrink-0 text-ouro-ink" /><div className="min-w-0"><span className={`text-sm font-medium ${p.found ? "text-muted-foreground line-through" : ""}`}>{p.title}</span>{Boolean(p.image_urls?.length) && <div className="mt-2 w-28"><RafflePhotos images={p.image_urls!} title={p.title} /></div>}</div></div><RaffleBadge status={p.found ? "paid" : "paused"}>{p.found ? "Encontrada · indisponível" : p.number !== null ? `Cota ${quotaLabel(p.number, c.total_numbers)}` : "Cota surpresa"}</RaffleBadge></div>)}<p className="rf-caption mt-2">A descoberta é confirmada depois do pagamento. O prêmio fica no seu cadastro.</p></div></details>}
      {d.results?.length > 0 && <section className="rf-panel grid gap-3 border-ouro/40"><h2 className="rf-panel-title"><Trophy size={18} className="text-ouro-ink" />Resultado do sorteio</h2>{d.results.map((r, i) => <div key={i} className="grid gap-2 rounded-xl bg-muted p-3 text-sm"><strong>{r.title} · Cota {quotaLabel(r.number, c.total_numbers)}</strong><p className="whitespace-pre-wrap text-muted-foreground">{r.note}</p>{r.status === "review" && <p>Resultado em análise pela equipe.</p>}{r.evidence?.startsWith("https://") && <a className="text-ouro-ink underline" href={r.evidence} target="_blank" rel="noopener noreferrer">Conferir resultado</a>}</div>)}</section>}
    </div>
    <section className="rf-panel grid min-w-0 gap-5"><div><h2 className="text-lg font-bold tracking-tight">{automatic ? "Quantas cotas você quer?" : "Escolha seus números"}</h2><p className="mt-1 text-xs text-muted-foreground">{available} disponíveis · De {quotaLabel(0, c.total_numbers)} a {quotaLabel(c.total_numbers - 1, c.total_numbers)}</p></div>
      {c.selection_mode === "both" && <div className="grid grid-cols-2 gap-1 rounded-xl border bg-muted p-1">{[[false, "Escolher números"], [true, "Automático"]].map(([value, label]) => <button key={String(label)} type="button" aria-pressed={automatic === value} className={`min-h-11 min-w-0 rounded-lg px-2 py-2 text-xs font-semibold ${automatic === value ? "bg-black text-amarelo dark:bg-amarelo dark:text-black" : "text-muted-foreground"}`} onClick={() => { setAutomatic(Boolean(value)); requestKey.current = null; }}>{String(label)}</button>)}</div>}
      {automatic ? <div className="grid gap-4"><label className="grid gap-2 text-sm font-medium">Quantidade de cotas<Input type="number" min={c.min_quantity} max={c.max_quantity} value={quantity} disabled={pending} onChange={e => { setQuantity(Number(e.target.value)); requestKey.current = null; }} /></label><div className="flex flex-wrap gap-2">{[...new Set([c.min_quantity, 5, 10, 20, c.max_quantity])].filter(n => n >= c.min_quantity && n <= c.max_quantity).slice(0, 5).map(n => <button className="rf-chip" aria-current={quantity === n ? "page" : undefined} key={n} type="button" disabled={pending} onClick={() => { setQuantity(n); requestKey.current = null; }}>{n} {n === 1 ? "cota" : "cotas"}</button>)}</div><p className="rf-caption">O sistema escolhe os números disponíveis para você no momento da reserva.</p></div> : <>
        <form className="rf-search" action={`${guest ? "/rifas" : "/painel/rifas"}/${c.id}`}><Search size={16} className="shrink-0 text-muted-foreground" /><input aria-label="Buscar cota" type="number" name="from" min={0} max={c.total_numbers - 1} placeholder="Buscar cota. Ex.: 007" /><button className="text-xs font-semibold text-ouro-ink">Buscar</button></form>
        <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex gap-2"><button type="button" className="rf-chip" aria-current={filter === "all" ? "page" : undefined} onClick={() => setFilter("all")}>Todas</button><button type="button" className="rf-chip" aria-current={filter === "available" ? "page" : undefined} onClick={() => setFilter("available")}>Disponíveis</button></div><span className="text-[11px] text-muted-foreground">{quotaLabel(from, c.total_numbers)}–{quotaLabel(Math.min(from + 99, c.total_numbers - 1), c.total_numbers)}</span></div>
        <div className="flex flex-wrap gap-x-3 gap-y-2 text-[10px] text-muted-foreground"><span><i className="rf-legend-dot bg-card" />Disponível</span><span><i className="rf-legend-dot bg-amarelo" />Selecionada</span><span><i className="rf-legend-dot bg-muted" />Reservada</span><span><i className="rf-legend-dot bg-emerald-500/20" />Paga</span></div>
        <div className="grid grid-cols-5 gap-2 sm:grid-cols-10 lg:grid-cols-5 xl:grid-cols-8">{visible.map(n => <button type="button" key={n.number} aria-label={`Cota ${quotaLabel(n.number, c.total_numbers)}: ${n.state === "paid" ? "paga" : n.state === "reserved" ? "reservada" : selected.includes(n.number) ? "selecionada" : "disponível"}`} aria-pressed={selected.includes(n.number)} data-state={n.state} disabled={pending || n.state !== "available" || c.status !== "open"} onClick={() => toggle(n.number)} className="rf-quota">{quotaLabel(n.number, c.total_numbers)}</button>)}</div>
        {!visible.length && <p className="rounded-xl bg-muted p-4 text-center text-sm text-muted-foreground">Nenhuma cota disponível neste intervalo. Tente a próxima página.</p>}
        <div className="flex items-center justify-between gap-2 text-xs">{from > 0 ? <Link className="rf-chip" href={`?from=${Math.max(0, from - 100)}`}>Anterior</Link> : <span className="rf-chip opacity-35">Anterior</span>}{from + 100 < c.total_numbers ? <Link className="rf-chip" href={`?from=${Math.min(c.total_numbers - 1, from + 100)}`}>Próximas</Link> : <span className="rf-chip opacity-35">Próximas</span>}</div>
        {selected.length > 0 && <div className="rounded-xl bg-muted p-3"><div className="mb-2 flex items-center justify-between gap-2 text-xs"><strong>Suas cotas</strong><button type="button" className="text-ouro-ink underline" disabled={pending} onClick={() => { setSelected([]); requestKey.current = null; }}>Limpar</button></div><p className="max-h-20 overflow-auto break-words text-xs tabular-nums text-muted-foreground">{selected.map(n => quotaLabel(n, c.total_numbers)).join(" · ")}</p></div>}
      </>}
      <p className="rf-caption">De {c.min_quantity} a {c.max_quantity} cotas por compra. Participações em rifas não geram Caracoins nem alteram seu elo.</p>
      <div className={qty > 0 ? "rf-checkout" : "rf-checkout-empty"} data-guest={guest}><div className="min-w-0"><span className="text-[11px] text-muted-foreground">{qty > 0 ? `${qty} ${qty === 1 ? "cota selecionada" : "cotas selecionadas"}` : "Selecione suas cotas para continuar"}</span>{qty > 0 && <strong className="block text-lg font-bold tracking-tight text-ouro-ink">{raffleMoney(qty * c.unit_price)}</strong>}</div>{qty > 0 && <Button aria-label={guest ? "Entrar ou criar conta para reservar" : "Reservar e pagar com Pix"} className="h-auto min-h-10 max-w-44 whitespace-normal px-3 py-2 text-xs" disabled={pending || !valid || c.status !== "open" || !enabled} onClick={() => start(async () => {
        if (guest) {
          try {
            sessionStorage.setItem(raffleIntentKey(c.id),JSON.stringify({automatic,quantity,numbers:selected}));
            router.push(commerceLoginHref(`/painel/rifas/${c.id}?from=${from}&resume=raffle`));
          } catch { toast.error("Permita o armazenamento do navegador para continuar com sua seleção."); }
          return;
        }
        requestKey.current ??= crypto.randomUUID();
        const r = await reserveRaffle({ campaign: c.id, key: requestKey.current, ...(automatic ? { quantity } : { numbers: selected }) });
        if (!r.ok) { toast.error(r.error); return; }
        router.push(`/painel/rifas?tab=orders&order=${r.data.id}`); router.refresh();
      })}><Ticket size={16} />{pending ? "Reservando…" : !enabled ? "Compras ainda não liberadas" : c.status !== "open" ? c.status === "closed" ? "Campanha encerrada" : "Vendas pausadas" : guest ? "Continuar" : "Reservar e pagar"}{enabled && c.status === "open" && !pending && <ArrowRight size={14} />}</Button>}{qty > 0 && <p className="rf-checkout-hint"><Clock3 size={11} />{guest ? "Entre para confirmar a reserva de 10 minutos." : "10 minutos para pagar após reservar"}</p>}{c.status !== "open" && <p className="rf-caption">{d.paid >= c.total_numbers ? "Todas as cotas já foram pagas. Aguarde a apuração." : "Esta campanha não está recebendo novas reservas."}</p>}</div>
    </section>
    <ImageLightbox images={images.map(src => ({ src, alt: c.title }))} index={photo} onOpenChange={setPhoto} />
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
  return <article id={order.id} className="rf-order">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h2 className="break-words font-bold">{order.campaign_title || "Participação na rifa"}</h2><p className="mt-1 text-xs text-muted-foreground">{order.code}</p><div className="mt-2"><RaffleBadge status={order.status} /></div></div>
      <strong className="text-ouro-ink">{raffleMoney(order.amount)}</strong>
    </div>
    <p className="text-sm">{order.numbers.length} cota(s)</p>
    <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto">{order.numbers.map(n => <span key={n} className="rf-ticket">{quotaLabel(n, order.total_numbers)}</span>)}</div>
    {order.status === "paid" && <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="size-4" />Pagamento confirmado. Boa sorte!</p>}
    {order.status === "paid" && awards.filter(a => a.order_id === order.id && !a.cancelled_at).map(a => <div role="status" key={a.id} className="rf-winner"><p className="flex items-center gap-2 text-lg font-bold text-ouro-ink"><Gift className="size-6" />Você ganhou!</p>{a.photos?.[0] && <picture><img src={a.photos[0]} alt={a.title} className="mt-2 h-40 w-full rounded-lg bg-background object-contain" loading="lazy" referrerPolicy="no-referrer" /></picture>}<p className="mt-2 font-semibold">{a.title}</p><p className="mt-1 text-sm">Cota {quotaLabel(a.number, a.total_numbers)} · Já está vinculado ao seu cadastro.</p><Link className="rf-button rf-button-primary mt-2 w-fit" href="/painel/rifas?tab=awards">Ver meu prêmio<ChevronRight size={15} /></Link></div>)}
    {active && <>
      <div className="rounded-xl border border-ouro/25 bg-ouro/5 p-3"><ReservationCountdown deadline={reservationDeadline} /></div>
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
