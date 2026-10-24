"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Award, Gift, Layers, LayoutGrid, MessageCircle, QrCode, Truck } from "lucide-react";

import { cn } from "@/lib/utils";

// Link do grupo de leilão (mesmo da landing). O botão do meio da bottom nav
// leva direto para lá — sem página própria dentro do painel.
const GROUP_URL = "https://chat.whatsapp.com/EYD5CmJ0Oer4aeM0zQ9mqu";

type Tab = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Só "/painel" casa exato; o resto casa prefixo (/painel/lotes/...). */
  exact?: boolean;
};

const TABS: Tab[] = [
  { href: "/painel", label: "Painel", icon: LayoutGrid, exact: true },
  { href: "/painel/lotes", label: "Lotes", icon: Layers },
  { href: "/painel/loja", label: "Loja", icon: Gift },
  { href: "/painel/ranking", label: "Ranking", icon: Award },
  { href: "/painel/pix", label: "Pix", icon: QrCode },
  { href: "/painel/envios", label: "Envios", icon: Truck },
];

/** Bottom nav: Loja fica ao lado dos lotes; Ranking vem logo após o grupo. */
export function ClientBottomNav() {
  const pathname = usePathname();
  const [before, after] = [TABS.slice(0, 3), TABS.slice(3)];

  const renderTab = (tab: Tab) => {
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
          "flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 transition-colors",
          active
            ? "font-medium text-ouro-ink"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Icon className="size-5 shrink-0" />
        <span className="max-w-full truncate px-0.5 text-[9px] uppercase tracking-[0.04em] sm:text-[10px]">{tab.label}</span>
      </Link>
    );
  };

  return (
    <nav
      aria-label="Navegação do painel"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-ouro/25 bg-background/90 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-xl shadow-[0_-4px_20px_rgba(0,0,0,0.35)]"
    >
      <div className="mx-auto flex h-16 w-full max-w-2xl items-center px-1">
        {before.map(renderTab)}

        <a
          href={GROUP_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Voltar ao grupo no WhatsApp"
          className="group mx-1 flex w-14 shrink-0 -translate-y-3.5 flex-col items-center sm:mx-2"
        >
          {/* Lombada: tile amarelo que se ergue acima da nav. */}
          <span className="flex size-14 flex-col items-center justify-center gap-0.5 rounded-t-[28px] rounded-b-2xl bg-amarelo text-[#0a0a0a] shadow-[0_-6px_16px_rgba(0,0,0,0.35)] ring-1 ring-ouro/40 transition-transform group-active:scale-95 sm:size-16">
            <MessageCircle className="size-5 sm:size-6" />
            <span className="w-12 text-center text-[7px] font-bold uppercase leading-tight tracking-wider sm:text-[8px]">
              Voltar ao Grupo
            </span>
          </span>
        </a>

        {after.map(renderTab)}
      </div>
    </nav>
  );
}
