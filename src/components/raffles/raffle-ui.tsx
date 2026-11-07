import { FinancialValue } from "@/components/admin/financial-privacy";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Gift, type LucideIcon } from "lucide-react";
import { raffleStatus } from "@/lib/raffles";

export function RaffleBadge({ status, children }: { status?: string; children?: React.ReactNode }) {
  const tone = status === "paid" || status === "open" ? "success" : status === "review" || status === "failed" ? "danger" : status === "paused" || status === "pending" || status === "creating" ? "gold" : "neutral";
  return <span className={`rf-badge rf-badge-${tone}`}><span className="rf-status-dot" />{children ?? raffleStatus[status ?? ""] ?? status}</span>;
}
export function RaffleMetric({ label, value, hint, icon: Icon }: { label: string; value: React.ReactNode; hint: string; icon: LucideIcon }) {
  return <article className="rf-metric"><span className="rf-icon-tile"><Icon size={20} /></span><div className="min-w-0"><p className="rf-eyebrow">{label}</p><p className="rf-metric-value">{typeof value === "string" && value.includes("R$") ? <FinancialValue>{value}</FinancialValue> : value}</p><p className="rf-caption">{hint.includes("R$") ? <FinancialValue>{hint}</FinancialValue> : hint}</p></div></article>;
}
export function RaffleProgress({ paid, reserved = 0, total }: { paid: number; reserved?: number; total: number }) {
  const percent = Math.min(100, Math.max(0, paid / Math.max(1, total) * 100));
  return <div className="grid gap-2"><div className="rf-progress" role="progressbar" aria-label="Cotas pagas" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.min(paid, total)}><span style={{ width: `${percent}%` }} /></div><div className="flex flex-wrap justify-between gap-1 text-xs text-muted-foreground"><span>{paid} pagas{reserved > 0 ? ` · ${reserved} reservadas` : ""}</span><strong className="text-ouro-ink">{Math.max(0, total - paid - reserved)} disponíveis</strong></div></div>;
}
export function RaffleEmpty({ title, description, href, action }: { title: string; description: string; href?: string; action?: string }) {
  return <div className="rf-empty"><span className="rf-icon-tile"><Gift size={26} /></span><h2 className="font-semibold">{title}</h2><p className="max-w-sm text-sm text-muted-foreground">{description}</p>{href && <Link className="rf-button rf-button-primary" href={href}>{action}<ArrowRight size={16} /></Link>}</div>;
}
export function RafflePagination({ page, more, href, count }: { page: number; more: boolean; href: (page: number) => string; count?: number }) {
  return <nav aria-label="Paginação" className="rf-pagination"><span>{count !== undefined ? `${count} resultado(s) · ` : ""}Página {page}</span><div className="flex items-center gap-2">{page > 1 ? <Link aria-label="Página anterior" className="rf-page-button" href={href(page - 1)}><ArrowLeft size={16} /></Link> : <span aria-disabled="true" className="rf-page-button opacity-35"><ArrowLeft size={16} /></span>}<span className="rf-page-current">{page}</span>{more ? <Link aria-label="Próxima página" className="rf-page-button" href={href(page + 1)}><ArrowRight size={16} /></Link> : <span aria-disabled="true" className="rf-page-button opacity-35"><ArrowRight size={16} /></span>}</div></nav>;
}
