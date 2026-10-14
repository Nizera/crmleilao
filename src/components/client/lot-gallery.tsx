"use client";

import { useState } from "react";
import Image from "next/image";

import { ImageLightbox } from "@/components/client/image-lightbox";

type Props = {
  images: string[];
  title: string;
};

export function LotGallery({ images, title }: Props) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {images.map((url, index) => (
          <button
            key={`${index}-${url}`}
            type="button"
            onClick={() => setViewerIndex(index)}
            className="relative aspect-square overflow-hidden rounded-md border bg-muted"
          >
            <Image
              src={url}
              alt={title}
              fill
              sizes="(min-width: 640px) 25vw, 33vw"
              className="object-cover"
            />
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Toque em uma foto para ampliar.</p>

      <ImageLightbox
        images={images.map((src) => ({ src, alt: title }))}
        index={viewerIndex}
        onOpenChange={setViewerIndex}
      />
    </div>
  );
}
