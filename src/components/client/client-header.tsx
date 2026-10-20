"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  Bell,
  History,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Sun,
  UserRound,
} from "lucide-react";

import { customerSignOut } from "@/app/actions/auth";
import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Props = {
  name: string | null;
  phone: string;
};

function initialsOf(name: string | null) {
  if (!name) return "?";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

/**
 * Top bar do painel (formato Stitch): lockup LEGENDS, pill de saldo
 * (placeholder), sino com pulse (toast placeholder) e avatar com dropdown
 * (Meus dados / Histórico / Tema / Sair).
 */
export function ClientHeader({ name, phone }: Props) {
  const { setTheme } = useTheme();

  return (
    <header className="sticky top-0 z-40 bg-background/85 pt-[env(safe-area-inset-top,0px)] backdrop-blur-xl after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-linear-to-r after:from-transparent after:via-ouro after:to-transparent after:content-['']">
      <div className="mx-auto flex h-16 w-full max-w-2xl items-center gap-3 px-4">
        <Link href="/painel" className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amarelo text-[#0a0a0a]">
            <LogoMark className="size-5" />
          </span>
          <span className="flex min-w-0 flex-col leading-none">
            <span className="truncate text-[15px] font-semibold uppercase tracking-widest">
              OCDL
            </span>
            <span className="truncate text-[10px] font-medium uppercase tracking-[0.2em] text-ouro-ink">
              Painel do Cliente
            </span>
          </span>
        </Link>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <div
            title="Em breve: saldo disponível"
            className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1"
          >
            <span className="text-xs font-bold text-muted-foreground">R$</span>
            <span className="text-sm font-bold tracking-tight text-ouro-ink">
              —
            </span>
          </div>

          <Button
            variant="ghost"
            size="icon"
            aria-label="Notificações"
            className="relative text-muted-foreground hover:text-foreground"
            onClick={() => toast.info("Em breve: notificações chegam aqui.")}
          >
            <Bell className="size-5" />
            <span className="absolute right-2.5 top-2.5 size-2 animate-pulse rounded-full bg-amarelo" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Menu da conta"
                className="rounded-full"
              >
                <span className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  {initialsOf(name)}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="truncate">{name ?? "Cliente"}</div>
                <div className="truncate text-xs font-normal text-muted-foreground">
                  {phone}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/painel/cadastro">
                  <UserRound />
                  Meus dados
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/painel/historico">
                  <History />
                  Histórico
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Palette />
                  Tema
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => setTheme("light")}>
                    <Sun />
                    Claro
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTheme("dark")}>
                    <Moon />
                    Escuro
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTheme("system")}>
                    <Monitor />
                    Sistema
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void customerSignOut()}>
                <LogOut />
                Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
