import Image from "next/image";
import Link from "next/link";
import { getLoyaltyTier } from "@/lib/loyalty-tiers";

const tierStyles = {
  lilas: "bg-purple-500/10 text-purple-800 ring-purple-500/30 dark:text-purple-200",
  bronze: "bg-orange-700/10 text-orange-900 ring-orange-600/30 dark:text-orange-200",
  prata: "bg-slate-500/10 text-slate-700 ring-slate-500/30 dark:text-slate-200",
  ouro: "bg-amarelo/15 text-ouro-ink ring-ouro/30",
  crumple: "bg-cyan-500/10 text-cyan-900 ring-cyan-500/30 dark:text-cyan-200",
  prizm: "bg-fuchsia-500/10 text-fuchsia-900 ring-fuchsia-500/30 dark:text-fuchsia-200",
};

export function CustomerTierBadge({ rankPoints }: { rankPoints: number | null }) {
  if (rankPoints === null) {
    return <Link href="/painel/ranking" className="flex min-h-11 shrink-0 items-center rounded-full bg-muted px-3 text-xs font-semibold text-muted-foreground" aria-label="Consultar seu elo no ranking">Ver elo</Link>;
  }
  const tier = getLoyaltyTier(rankPoints);
  return (
    <Link href="/painel/ranking"
      className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-full py-1 pl-1.5 pr-3 ring-1 transition hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 ${tierStyles[tier.key]}`}
      aria-label={`Seu elo: ${tier.name}. Ver ranking e progresso.`}
      title={`Seu elo: ${tier.name}`}>
      <Image src={`/elos/${tier.key}.svg`} alt="" width={40} height={40} className="size-10 shrink-0 object-contain drop-shadow-sm" />
      <span className="text-[11px] font-bold uppercase tracking-wide">{tier.name}</span>
    </Link>
  );
}
