"use client";

import Link from "next/link";
import { History, LogOut, UserRound } from "lucide-react";

import { customerSignOut } from "@/app/actions/auth";
import { Logo } from "@/components/brand/logo";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Button } from "@/components/ui/button";

type Props = {
  name: string | null;
  phone: string;
};

export function ClientHeader({ name, phone }: Props) {
  return (
    <header className="sticky top-0 z-40 bg-background/95 backdrop-blur after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-linear-to-r after:from-transparent after:via-ouro after:to-transparent after:content-['']">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4 md:px-6">
        <Link href="/painel">
          <Logo hideNameOnMobile />
        </Link>

        <div className="ml-auto flex items-center gap-3">
          <ThemeSwitcher />
          <div className="hidden text-right leading-tight sm:block">
            <div className="text-sm font-medium">{name ?? "Cliente"}</div>
            <div className="text-xs text-muted-foreground">{phone}</div>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/painel/historico">
              <History />
              <span className="hidden sm:inline">Histórico</span>
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/painel/cadastro">
              <UserRound />
              Meus dados
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void customerSignOut()}
          >
            <LogOut />
            Sair
          </Button>
        </div>
      </div>
    </header>
  );
}
