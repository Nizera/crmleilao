"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { ArrowDownWideNarrow, Gift, Search, Sparkles } from "lucide-react";
import { requestLoyaltyRedemption } from "@/app/actions/loyalty";
import { Button } from "@/components/ui/button";

type Reward = {
  id: string;
  name: string;
  description: string | null;
  points_cost: number | null;
  stock: number | null;
  image_path: string | null;
};

const points = (value: number) => new Intl.NumberFormat("pt-BR").format(value);

function RewardImage({ reward, priority = false }: { reward: Reward; priority?: boolean }) {
  const imageUrl = reward.image_path
    ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/lot-images/${reward.image_path}`
    : null;
  return <div className="relative aspect-[4/3] overflow-hidden bg-white">
    {imageUrl ? <Image src={imageUrl} alt={reward.name} fill priority={priority} sizes="(max-width: 640px) 78vw, (max-width: 1280px) 32vw, 24vw" className="object-contain p-3 transition-transform duration-300 group-hover:scale-[1.04]" /> : <div className="grid size-full place-items-center text-ouro-ink"><Gift className="size-9" /></div>}
  </div>;
}

function ProductCard({ reward, balance, compact = false, priority = false }: { reward: Reward; balance: number; compact?: boolean; priority?: boolean }) {
  const cost = reward.points_cost == null ? null : Number(reward.points_cost);
  const soldOut = reward.stock === 0;
  const canRedeem = cost !== null && balance >= cost && !soldOut;
  const missing = cost === null ? 0 : Math.max(0, cost - balance);
  return <article id={compact ? undefined : `catalogo-${reward.id}`} className={`group overflow-hidden rounded-2xl border bg-card shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${compact ? "w-[min(48vw,220px)] shrink-0 snap-start" : "min-w-0"}`}>
    <div className="relative">
      <RewardImage reward={reward} priority={priority} />
      {soldOut && <span className="absolute left-2 top-2 rounded-full bg-black/75 px-2.5 py-1 text-[11px] font-semibold text-white">Esgotado</span>}
      {!soldOut && reward.stock !== null && reward.stock > 0 && reward.stock <= 5 && <span className="absolute left-2 top-2 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-900">Últimas unidades</span>}
      {compact && <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-background/90 px-2 py-1 text-[10px] font-semibold"><Sparkles className="size-3 text-ouro-ink" /> Novo</span>}
    </div>
    <div className={compact ? "grid gap-2 p-3" : "grid h-full content-between gap-3 p-3 sm:p-4"}>
      <div className="min-w-0">
        <h3 className={`font-semibold leading-snug ${compact ? "line-clamp-2 min-h-10 text-sm" : "line-clamp-2 min-h-10 text-sm sm:text-base"}`}>{reward.name}</h3>
        {!compact && reward.description && <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground sm:text-sm">{reward.description}</p>}
      </div>
      <div className="grid gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
          <p className="text-base font-bold tracking-tight text-ouro-ink">{cost === null ? "A definir" : `${points(cost)} pts`}</p>
          {reward.stock !== null && !soldOut && <p className="text-[11px] text-muted-foreground">{points(reward.stock)} em estoque</p>}
        </div>
        {compact ? <a href={`#catalogo-${reward.id}`} className="text-xs font-semibold text-ouro-ink underline underline-offset-4">Ver recompensa</a> : <form action={requestLoyaltyRedemption}><input type="hidden" name="reward_id" value={reward.id} /><Button type="submit" className="w-full" size="sm" disabled={!canRedeem}>{soldOut ? "Indisponível" : cost === null ? "Em breve" : canRedeem ? "Resgatar recompensa" : `Faltam ${points(missing)} pts`}</Button></form>}
      </div>
    </div>
  </article>;
}

export function LoyaltyStorefront({ rewards, balance }: { rewards: Reward[]; balance: number }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "available" | "in-stock">("all");
  const [sort, setSort] = useState<"recommended" | "points-asc" | "points-desc">("recommended");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    const result = rewards.filter((reward) => {
      const matches = !normalized || `${reward.name} ${reward.description ?? ""}`.toLocaleLowerCase("pt-BR").includes(normalized);
      const cost = reward.points_cost == null ? null : Number(reward.points_cost);
      const hasStock = reward.stock === null || reward.stock > 0;
      const matchesFilter = filter === "all" || (filter === "available" ? cost !== null && balance >= cost && hasStock : hasStock);
      return matches && matchesFilter;
    });
    if (sort !== "recommended") result.sort((a, b) => {
      const aCost = a.points_cost == null ? Number.POSITIVE_INFINITY : Number(a.points_cost);
      const bCost = b.points_cost == null ? Number.POSITIVE_INFINITY : Number(b.points_cost);
      return sort === "points-asc" ? aCost - bCost : bCost - aCost;
    });
    return result;
  }, [balance, filter, query, rewards, sort]);
  const featured = rewards.slice(0, 5);
  const filters = [["all", "Todas"], ["available", "Posso resgatar"], ["in-stock", "Em estoque"]] as const;

  return <div className="grid gap-7">
    {featured.length > 0 && <section aria-labelledby="loja-destaques" className="grid gap-3">
      <div className="flex items-end justify-between gap-3"><div><p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ouro-ink"><Sparkles className="size-3.5" /> Chegaram por último</p><h2 id="loja-destaques" className="mt-1 text-lg font-bold">Novidades da loja</h2></div><span className="text-xs text-muted-foreground">Deslize para ver mais</span></div>
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">{featured.map((reward, index) => <ProductCard key={reward.id} reward={reward} balance={balance} compact priority={index < 2} />)}</div>
    </section>}
    <section aria-labelledby="loja-catalogo" className="grid gap-4">
      <div className="grid gap-3 sm:flex sm:items-end sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Explore e aproveite</p><h2 id="loja-catalogo" className="mt-1 text-xl font-bold">Todas as recompensas</h2><p className="mt-1 text-sm text-muted-foreground">Use seus pontos para pedir os itens disponíveis.</p></div>
        <label className="relative block w-full sm:max-w-xs"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar na loja" className="h-10 w-full rounded-xl border bg-background pl-9 pr-3 text-sm outline-none ring-ouro/30 transition focus:ring-2" /></label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex max-w-full gap-2 overflow-x-auto pb-1">{filters.map(([key, label]) => <button key={key} type="button" onClick={() => setFilter(key)} aria-pressed={filter === key} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${filter === key ? "border-ouro bg-amarelo/20 text-ouro-ink" : "bg-card text-muted-foreground hover:text-foreground"}`}>{label}</button>)}</div>
        <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground"><ArrowDownWideNarrow className="size-4" /><span className="sr-only">Ordenar por</span><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="max-w-40 rounded-lg border bg-background px-2 py-2 text-xs text-foreground"><option value="recommended">Recomendados</option><option value="points-asc">Menos pontos</option><option value="points-desc">Mais pontos</option></select></label>
      </div>
      {filtered.length === 0 ? <div className="rounded-2xl border border-dashed p-8 text-center"><Gift className="mx-auto size-8 text-muted-foreground" /><p className="mt-2 font-semibold">Nenhuma recompensa encontrada</p><p className="mt-1 text-sm text-muted-foreground">Tente outro nome ou filtro.</p></div> : <div className="grid grid-cols-2 items-stretch gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">{filtered.map((reward) => <ProductCard key={reward.id} reward={reward} balance={balance} />)}</div>}
    </section>
  </div>;
}
