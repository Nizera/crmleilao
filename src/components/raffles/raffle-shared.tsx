import Link from "next/link";
import { Ticket, Gift, ArrowRight } from "lucide-react";
import type { Raffle } from "@/lib/raffles";
import { raffleMoney, raffleStatus } from "@/lib/raffles";

export function RaffleCard({ campaign: c, admin = false }: { campaign: Raffle; admin?: boolean }) {
  return <Link href={`${admin ? "/admin/rifa" : "/painel/rifas"}/${c.id}`} className="group overflow-hidden rounded-2xl border bg-card transition-shadow hover:shadow-md">
    <div className="relative flex aspect-[16/9] items-center justify-center overflow-hidden bg-gradient-to-br from-amarelo/20 via-muted to-background">
      {/* Imagens externas são renderizadas pelo navegador; nunca buscadas no servidor. */}
      {c.image_url ? <picture><img src={c.image_url} alt={c.title} className="size-full max-h-64 object-contain" loading="lazy" referrerPolicy="no-referrer" /></picture> : <Gift className="size-16 text-ouro-ink" />}
      <span className="absolute left-3 top-3 rounded-full bg-background/95 px-3 py-1 text-xs font-semibold">{c.archived_at?"Arquivada":raffleStatus[c.status]}</span>
    </div>
    <div className="grid gap-3 p-4"><h2 className="font-bold leading-snug">{c.title}</h2><p className="text-xl font-bold text-ouro-ink">{raffleMoney(c.unit_price)} <span className="text-xs font-normal text-muted-foreground">por cota</span></p><p className="text-xs text-muted-foreground">{c.total_numbers.toLocaleString("pt-BR")} cotas · {c.draw_method === "federal" ? "Loteria Federal" : "Sorteador externo"}</p><span className="flex items-center gap-2 text-sm font-semibold"><Ticket className="size-4" />{admin ? "Gerenciar campanha" : c.status === "open" ? "Quero participar" : "Ver campanha"}<ArrowRight className="ml-auto size-4" /></span></div>
  </Link>;
}
export function RaffleUnavailable() {
  return <div role="alert" className="rounded-xl border p-5 text-sm">Não foi possível carregar as rifas. Suas participações continuam salvas. Se esta é a primeira configuração, aplique a migration 0043 e atualize a página.</div>;
}
