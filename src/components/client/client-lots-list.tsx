"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { ImageIcon } from "lucide-react";

import { LotStatusBadge } from "@/components/admin/lots/lot-status-badge";
import { ImageLightbox } from "@/components/client/image-lightbox";
import { formatBRL, formatDateBR, lotImageUrl, type Lot } from "@/lib/lots";

type Props = {
  lots: Lot[];
};

export function ClientLotsList({ lots }: Props) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

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

  return (
    <>
      <ul className="flex flex-col gap-2">
        {rows.map(({ lot, images, startIndex }) => {
          const cover = images[0] ?? null;

          return (
            <li key={lot.id}>
              <div className="flex items-center gap-3 rounded-md border p-3 transition hover:bg-muted/50">
                {cover ? (
                  <button
                    type="button"
                    onClick={() => setOpenIndex(startIndex)}
                    aria-label={`Ver fotos de ${lot.title}`}
                    className="relative size-12 shrink-0 overflow-hidden rounded-md border bg-muted"
                  >
                    <Image
                      src={cover}
                      alt={lot.title}
                      fill
                      sizes="48px"
                      className="object-cover"
                    />
                    {images.length > 1 && (
                      <span className="absolute bottom-0.5 right-0.5 flex size-4 items-center justify-center rounded bg-black/60 text-[10px] font-medium text-white">
                        {images.length}
                      </span>
                    )}
                  </button>
                ) : (
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                    <ImageIcon className="size-5" />
                  </span>
                )}

                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Link
                    href={`/painel/lotes/${lot.code}`}
                    className="truncate font-medium leading-tight hover:underline"
                  >
                    {lot.title}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {formatBRL(lot.arremate_value)} · envio{" "}
                    {formatDateBR(lot.shipping_date)}
                  </span>
                  <span>
                    <LotStatusBadge status={lot.status} size="sm" />
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <ImageLightbox
        images={flat}
        index={openIndex}
        onOpenChange={setOpenIndex}
      />
    </>
  );
}
