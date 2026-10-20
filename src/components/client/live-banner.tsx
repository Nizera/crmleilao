"use client";

import { Bell, ExternalLink } from "lucide-react";
import { toast } from "sonner";

// Link do grupo de leilão (mesmo da landing). Quando houver integração de
// agenda, "Lembrete" vira notificação real; hoje é placeholder com toast.
const GROUP_URL = "https://chat.whatsapp.com/EYD5CmJ0Oer4aeM0zQ9mqu";

/** Banner "Ao Vivo / Mega Drop" (placeholder visual aprovado no redesign). */
export function LiveBanner() {
  return (
    <section className="relative overflow-hidden rounded-xl bg-gradient-to-r from-card via-muted/40 to-card p-4 shadow-md ring-1 ring-ouro/25">
      <div className="pointer-events-none absolute -right-4 -top-8 size-24 rounded-full bg-amarelo/10 blur-xl" />
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amarelo opacity-75" />
            <span className="relative inline-flex size-2.5 rounded-full bg-amarelo" />
          </span>
          <span className="text-[11px] font-bold uppercase tracking-widest text-ouro-ink">
            Ao Vivo • Mega Drop
          </span>
        </span>
        <span className="rounded bg-background px-2 py-0.5 text-[10px] font-bold text-foreground">
          COPA 2026
        </span>
      </div>
      <p className="mt-1.5 text-sm font-bold leading-snug">
        Mega Drop Copa 2026: Figurinhas Raras &amp; Legends
      </p>
      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={() =>
            toast.info("Em breve: lembrete do próximo leilão ao vivo.")
          }
          className="flex items-center gap-1 rounded-lg bg-muted px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-foreground transition hover:bg-muted/70"
        >
          <Bell className="size-4" />
          Lembrete
        </button>
        <a
          href={GROUP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 rounded-lg bg-amarelo/20 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-ouro-ink transition hover:bg-amarelo/30"
        >
          <ExternalLink className="size-4" />
          Ver Catálogo
        </a>
      </div>
    </section>
  );
}
