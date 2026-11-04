import Link from "next/link";
import { Check, Gift, Package, Truck, Trophy } from "lucide-react";
import type { RaffleAward } from "@/lib/raffles";
import { quotaLabel } from "@/lib/raffles";
import { raffleAwardStage } from "@/lib/raffle-presentation";
import { RafflePhotos } from "@/components/raffles/raffle-photos";
import { RaffleBadge } from "@/components/raffles/raffle-ui";

export function RaffleAwardCard({ award: a, images = [], admin = false }: { award: RaffleAward & { customer_name?: string }; images?: string[]; admin?: boolean }) {
  const stage = raffleAwardStage(a);
  const Icon = a.kind === "main" ? Trophy : Gift;
  return <article className="rf-award-card">
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="rf-badge rf-badge-gold"><Icon size={14} />{a.kind === "main" ? "Prêmio principal" : "Cota premiada"}</span><RaffleBadge status={stage.index < 0 ? "review" : stage.index === 3 ? "paid" : "paused"}>{stage.label}</RaffleBadge></div>
    <RafflePhotos images={images} title={a.title} />
    <div><h2 className="text-lg font-bold tracking-tight">{a.title}</h2><p className="mt-1 text-xs text-muted-foreground">{a.campaign_title} · Cota {quotaLabel(a.number, a.total_numbers)}</p>{admin && <p className="mt-2 text-sm font-semibold">{a.customer_name}</p>}</div>
    {stage.index >= 0 && <div className="rf-stepper" aria-label={`Situação do prêmio: ${stage.label}`}>{[{ label: "Conquistado", icon: Check }, { label: "Na sua caixa", icon: Package }, { label: stage.index === 3 ? "Entregue" : "Envio", icon: Truck }].map((step, index) => <div key={step.label} className={`rf-step ${index < stage.index || stage.index === 3 ? "is-done" : index === stage.index ? "is-current" : ""}`}><span><step.icon size={13} /></span>{index === 1 && stage.index === 0 ? "Aguardando separação" : step.label}</div>)}</div>}
    {a.tracking_code && <p className="break-all rounded-lg bg-muted p-3 text-xs"><strong>Rastreio:</strong> {a.tracking_code}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3"><p className="rf-caption">{admin ? "Prêmio vinculado ao cadastro do ganhador." : "Seu prêmio já está vinculado ao seu cadastro."}</p>{admin ? <Link className="text-xs font-semibold text-ouro-ink underline" href={`/admin/rifa/${a.campaign_id}`}>Ver campanha</Link> : a.shipment_id && a.shipment_status !== "cancelled" ? <Link className="text-xs font-semibold text-ouro-ink underline" href="/painel/envios">Acompanhar envio</Link> : null}</div>
  </article>;
}
