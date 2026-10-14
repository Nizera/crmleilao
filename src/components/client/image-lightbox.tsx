"use client";

import { useCallback, useEffect, useRef } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

import { cn } from "@/lib/utils";

type Props = {
  images: { src: string; alt: string }[];
  /** Índice da imagem aberta, ou null com o lightbox fechado. */
  index: number | null;
  onOpenChange: (index: number | null) => void;
};

/**
 * Lightbox simples: fundo escuro, imagem central, setas e Esc.
 * Sem dependência de dialog — controlado pelo pai (lista de lotes).
 *
 * Focus trap + retorno do foco: sem isso o teclado continua navegando a
 * página atrás do modal e o leitor de tela não enxerga o diálogo.
 */
export function ImageLightbox({ images, index, onOpenChange }: Props) {
  const close = useCallback(() => onOpenChange(null), [onOpenChange]);

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  const go = useCallback(
    (delta: number) => {
      if (index == null) return;
      const next = (index + delta + images.length) % images.length;
      onOpenChange(next);
    },
    [index, images.length, onOpenChange],
  );

  const isOpen = index != null;

  // Sobe/desce o foco junto com o abrir/fechar (não a cada troca de imagem).
  useEffect(() => {
    if (!isOpen) return;

    lastFocusedRef.current = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    return () => {
      lastFocusedRef.current?.focus();
      lastFocusedRef.current = null;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const focusables = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        return;
      }
      if (event.key === "ArrowLeft") {
        go(-1);
        return;
      }
      if (event.key === "ArrowRight") {
        go(1);
        return;
      }
      if (event.key !== "Tab") return;

      const items = focusables();
      if (items.length === 0) return;

      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      const inside = active instanceof Node && dialogRef.current?.contains(active);

      if (!inside) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [isOpen, close, go]);

  if (index == null || images.length === 0) return null;

  const current = index;
  const active = images[Math.min(current, images.length - 1)];
  const multiple = images.length > 1;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={active.alt}
      className="fixed inset-0 z-[100] flex flex-col bg-black/90"
      onClick={close}
    >
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm text-white/70 tabular-nums">
          {current + 1} / {images.length}
        </span>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={close}
          aria-label="Fechar"
          className="flex size-9 items-center justify-center rounded-full text-white/80 transition hover:bg-white/10 hover:text-white"
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="relative flex flex-1 items-center justify-center px-2 pb-6">
        <Image
          src={active.src}
          alt={active.alt}
          fill
          sizes="100vw"
          className="rounded-md object-contain"
          onClick={(event) => event.stopPropagation()}
        />

        {multiple && (
          <>
            <button
              type="button"
              aria-label="Imagem anterior"
              onClick={(event) => {
                event.stopPropagation();
                go(-1);
              }}
              className={cn(
                "absolute left-2 flex size-10 items-center justify-center rounded-full",
                "bg-white/10 text-white transition hover:bg-white/20",
              )}
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              type="button"
              aria-label="Próxima imagem"
              onClick={(event) => {
                event.stopPropagation();
                go(1);
              }}
              className={cn(
                "absolute right-2 flex size-10 items-center justify-center rounded-full",
                "bg-white/10 text-white transition hover:bg-white/20",
              )}
            >
              <ChevronRight className="size-5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
