"use client";

import Link from "next/link";
import { LogOut, Trophy, UserRound } from "lucide-react";

import { customerSignOut } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";

type Props = {
  name: string | null;
  phone: string;
};

export function ClientHeader({ name, phone }: Props) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4 md:px-6">
        <Link href="/painel" className="flex items-center gap-2 font-semibold">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Trophy className="size-4" />
          </span>
          <span className="hidden sm:inline">Meu painel</span>
        </Link>

        <div className="ml-auto flex items-center gap-3">
          <div className="hidden text-right leading-tight sm:block">
            <div className="text-sm font-medium">{name ?? "Cliente"}</div>
            <div className="text-xs text-muted-foreground">{phone}</div>
          </div>
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
