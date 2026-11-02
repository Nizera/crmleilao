"use client";
import { useState } from "react";
import { ImageLightbox } from "@/components/client/image-lightbox";

export function RafflePhotos({ images, title }: { images: string[]; title: string }) {
  const [index, setIndex] = useState<number | null>(null);
  if (!images.length) return null;
  return <div className="grid min-w-0 gap-2">
    <button type="button" aria-label={`Ampliar foto de ${title}`} onClick={() => setIndex(0)} className="flex aspect-[4/3] max-h-72 w-full items-center justify-center overflow-hidden rounded-xl border bg-muted">
      <picture className="contents"><img src={images[0]} alt={title} className="size-full object-contain" referrerPolicy="no-referrer" /></picture>
    </button>
    {images.length > 1 && <div className="flex flex-wrap gap-2">{images.map((src, i) => <button key={src} type="button" aria-label={`Ampliar foto ${i + 1} de ${title}`} onClick={() => setIndex(i)} className="size-16 overflow-hidden rounded-lg border bg-muted"><picture><img src={src} alt="" loading="lazy" className="size-full object-contain" referrerPolicy="no-referrer" /></picture></button>)}</div>}
    <p className="text-xs text-muted-foreground">Toque na foto para ampliar.</p>
    <ImageLightbox images={images.map(src => ({ src, alt: title }))} index={index} onOpenChange={setIndex} />
  </div>;
}
