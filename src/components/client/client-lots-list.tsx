"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { CalendarDays, ImageIcon, Search } from "lucide-react";

import { LotStatusBadge } from "@/components/admin/lots/lot-status-badge";
import { EmptyState } from "@/components/empty-state";
import { ImageLightbox } from "@/components/client/image-lightbox";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBRL, formatDateBR, lotImageUrl, LOT_STATUS_LABELS, LOT_STATUSES, type Lot, type LotStatus } from "@/lib/lots";

type Props = {
  lots: Lot[];
  /** Subtítulo do cabeçalho (ex.: "2 lotes arrematados em 18/10/2026"). */
  subtitle?: string;
};

export function ClientLotsList({ lots, subtitle }: Props) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [filter, setFilter] = useState<LotStatus | "all">("all");
  const [search, setSearch] = useState("");

  if (lots.length === 0) {
    return (
      <section className="flex flex-col gap-2">
        <div className="flex items-end justify-between gap-2">
          <div className="flex min-w-0 flex-col">
            <h2 className="text-base font-bold tracking-tight">Seus Lotes</h2>
            {subtitle && (
              <span className="truncate text-xs text-muted-foreground">
                {subtitle}
              </span>
            )}
          </div>
        </div>
        <EmptyState
          image="/brand/empty-lots.png"
          title="Nenhum lote ainda"
          description="Quando você arrematar um lote no leilão, ele aparece aqui com foto e valor."
        />
      </section>
    );
  }

  const rows: { lot: Lot; images: string[]; startIndex: number }[] = [];
  {
    let cursor = 0;
    for (const lot of lots) {
      const images = lot.images
        .map((path) => lotImageUrl(path))
        .filter((url): url is string => Boolean(url));
      rows.push({ lot, images, startIndex: cursor });
      cursor += images.length;
    }
  }

  const flat = rows.flatMap(({ lot, images }) =>
    images.map((src) => ({ src, alt: lot.title })),
  );

  const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR");
  const visibleRows = rows.filter(({ lot }) => {
    const statusMatches = filter === "all" || lot.status === filter;
    const textMatches = !normalizedSearch || `${lot.code} ${lot.title} ${lot.description ?? ""}`.toLocaleLowerCase("pt-BR").includes(normalizedSearch);
    return statusMatches && textMatches;
  });
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-end justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <h2 className="text-base font-bold tracking-tight">Seus Lotes</h2>
          {subtitle && (
            <span className="truncate text-xs text-muted-foreground">
              {subtitle}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border bg-background px-3 py-2">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <span className="sr-only">Buscar lote por código, nome ou descrição</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por código, nome ou descrição" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
        </label>
        <select aria-label="Filtrar lotes por situação" value={filter} onChange={(event) => setFilter(event.target.value as LotStatus | "all")} className="rounded-lg border bg-background px-3 py-2 text-sm">
          <option value="all">Todas as situações ({rows.length})</option>
          {LOT_STATUSES.map((status) => <option key={status} value={status}>{LOT_STATUS_LABELS[status]}</option>)}
        </select>
      </div>

      <ul className="flex flex-col gap-2">
        {visibleRows.map(({ lot, images, startIndex }) => {
          const cover = images[0] ?? null;
          const pending = lot.status === "pending_payment";

          return (
            <li
              key={lot.id}
              className="flex gap-3 rounded-xl bg-card p-3 shadow-sm ring-1 ring-foreground/10"
            >
              {cover ? (
                <button
                  type="button"
                  onClick={() => setOpenIndex(startIndex)}
                  aria-label={`Ver fotos de ${lot.title}`}
                  className="relative h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-muted shadow-md"
                >
                  <Image
                    src={cover}
                    alt={lot.title}
                    fill
                    sizes="64px"
                    className="object-cover"
                  />
                  {images.length > 1 && (
                    <span className="absolute right-0.5 bottom-0.5 flex size-4 items-center justify-center rounded bg-black/60 text-[10px] font-medium text-white">
                      {images.length}
                    </span>
                  )}
                  <span className="absolute inset-x-0 bottom-0 bg-black/70 py-0.5 text-center">
                    <span className="font-mono text-[8px] font-bold uppercase tracking-widest text-amarelo">
                      {lot.code}
                    </span>
                  </span>
                </button>
              ) : (
                <span className="flex h-20 w-16 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <ImageIcon className="size-5" />
                </span>
              )}

              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center justify-between gap-1">
                  <span className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
                    Lote #{lot.code}
                  </span>
                  <LotStatusBadge status={lot.status} size="sm" />
                </div>
                <Link
                  href={`/painel/lotes/${lot.code}`}
                  className="mt-0.5 truncate text-sm font-bold leading-tight hover:underline"
                >
                  {lot.title}
                </Link>
                <div className="mt-1 flex items-center gap-2">
                  <span
                    className={cn(
                      "text-sm font-bold",
                      pending ? "text-ouro-ink" : "text-foreground",
                    )}
                  >
                    {formatBRL(lot.arremate_value)}
                  </span>
                  <span className="text-xs text-muted-foreground">•</span>
                  <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                    <CalendarDays className="size-3.5" />
                    Envio {formatDateBR(lot.shipping_date)}
                  </span>
                </div>
                <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                  <span className="truncate text-[10px] font-medium uppercase text-muted-foreground">
                    Lance vencedor: você
                  </span>
                  {pending ? (
                    <Link href="/painel/pix">
                      <Button
                        size="sm"
                        className="rounded-md px-2.5 text-[10px] font-bold uppercase tracking-wider"
                      >
                        Pagar Lote
                      </Button>
                    </Link>
                  ) : (
                    <Link href={`/painel/lotes/${lot.code}`}>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="rounded-md px-2.5 text-[10px] font-bold uppercase tracking-wider"
                      >
                        Ver
                      </Button>
                    </Link>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {visibleRows.length === 0 && (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhum lote corresponde à busca e ao filtro escolhidos.</p>
      )}

      <ImageLightbox
        images={flat}
        index={openIndex}
        onOpenChange={setOpenIndex}
      />
    </section>
  );
}
