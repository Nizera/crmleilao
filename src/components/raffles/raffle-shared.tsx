import Link from "next/link";
import { Ticket, Gift, ArrowRight } from "lucide-react";
import { RaffleBadge, RaffleProgress } from "@/components/raffles/raffle-ui";
import type { RaffleSummary } from "@/lib/raffle-presentation";
import type { Raffle } from "@/lib/raffles";
import { raffleMoney, raffleStatus } from "@/lib/raffles";

export function RaffleCard({ campaign: c, admin = false, summary }: { campaign: Raffle; admin?: boolean; summary?: RaffleSummary }) {
  return <Link href={`${admin ? "/admin/rifa" : "/painel/rifas"}/${c.id}`} className="rf-campaign-card">
    <div className="rf-campaign-cover">
      {c.image_url ? <picture><img src={c.image_url} alt={c.title} loading="lazy" referrerPolicy="no-referrer" /></picture> : <Gift className="size-16 text-ouro-ink" />}
      <div className="absolute left-3 top-3"><RaffleBadge status={c.status}>{c.archived_at ? "Arquivada" : c.status === "paused" && summary && summary.paid >= c.total_numbers ? "Aguardando apuração" : raffleStatus[c.status]}</RaffleBadge></div>
    </div>
    <div className="rf-campaign-card-body"><div><h2 className="text-lg font-bold leading-snug tracking-tight">{c.title}</h2><p className="rf-campaign-price mt-2">{raffleMoney(c.unit_price)} <span className="text-xs font-normal text-muted-foreground">por cota</span></p></div>
      {summary ? <RaffleProgress paid={summary.paid} reserved={summary.reserved} total={c.total_numbers} /> : <p className="rf-caption">{c.total_numbers.toLocaleString("pt-BR")} cotas · {c.draw_method === "federal" ? "Loteria Federal" : "Sorteador externo"}</p>}
      {Boolean(summary?.instantPrizes) && <span className="rf-badge rf-badge-gold w-fit"><Gift size={13} />{summary!.instantPrizes} cotas premiadas</span>}
      <span className="rf-campaign-cta"><Ticket size={16} />{admin ? "Gerenciar campanha" : c.status === "open" ? "Quero participar" : "Ver campanha"}<ArrowRight size={16} /></span>
    </div>
  </Link>;
}
export function RaffleUnavailable() {
  return <div role="alert" className="rounded-xl border p-5 text-sm">Não foi possível carregar as rifas agora. Suas participações continuam salvas. Atualize a página para tentar novamente.</div>;
}
