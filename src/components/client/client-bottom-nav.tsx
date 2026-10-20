"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Gavel, Layers, LayoutGrid, QrCode, Truck } from "lucide-react";

import { cn } from "@/lib/utils";

type Tab = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Só "/painel" casa exato; o resto casa prefixo (/painel/lotes/...). */
  exact?: boolean;
  /** Tab "Ao Vivo" ganha badge pulsante (placeholder de leilão rodando). */
  live?: boolean;
};

const TABS: Tab[] = [
  { href: "/painel", label: "Painel", icon: LayoutGrid, exact: true },
  { href: "/painel/lotes", label: "Lotes", icon: Layers },
  { href: "/painel/ao-vivo", label: "Ao Vivo", icon: Gavel, live: true },
  { href: "/painel/pix", label: "Pix", icon: QrCode },
  { href: "/painel/envios", label: "Envios", icon: Truck },
];

/** Bottom nav fixa do painel (5 abas, igual ao protótipo Stitch). */
export function ClientBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegação do painel"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-ouro/25 bg-background/90 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-xl shadow-[0_-4px_20px_rgba(0,0,0,0.35)]"
    >
      <div className="mx-auto flex h-16 w-full max-w-2xl items-center justify-around px-1">
        {TABS.map((tab) => {
          const active = tab.exact
            ? pathname === tab.href
            : pathname.startsWith(tab.href);
          const Icon = tab.icon;

          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-12 min-w-[56px] flex-col items-center justify-center gap-0.5 transition-colors",
                active
                  ? "font-medium text-ouro-ink"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.live ? (
                <span className="relative flex items-center justify-center">
                  <Icon className="size-[22px]" />
                  <span className="absolute -top-1 -right-2.5 flex size-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amarelo opacity-75" />
                    <span className="relative inline-flex size-2 rounded-full bg-amarelo" />
                  </span>
                </span>
              ) : (
                <Icon className="size-[22px]" />
              )}
              <span className="text-[10px] uppercase tracking-wider">
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
