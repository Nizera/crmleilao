"use client";

import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";

import { adminSignOut } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ADMIN_ROLE_LABELS, type AdminRole } from "@/lib/roles";

const labels: Record<string, string> = {
  "/admin/dashboard": "Dashboard",
  "/admin/lotes": "Lotes",
  "/admin/clientes": "Clientes",
  "/admin/cobrancas": "Cobranças",
  "/admin/estoque": "Estoque",
  "/admin/envios": "Envios",
  "/admin/configuracao": "Configuração",
};

type Props = {
  name: string;
  role: AdminRole;
};

export function AdminHeader({ name, role }: Props) {
  const pathname = usePathname();
  const current =
    labels[pathname] ??
    Object.entries(labels).find(([k]) => pathname.startsWith(`${k}/`))?.[1] ??
    "Painel";

  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-2 h-4" />
        <h1 className="text-base font-medium">{current}</h1>

        <div className="ml-auto flex items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2 px-2">
                <Avatar className="size-7">
                  <AvatarFallback className="text-xs">
                    {initials || "AD"}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden text-sm font-medium md:inline">
                  {name}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="flex flex-col">
                <span>{name}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {ADMIN_ROLE_LABELS[role]}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  void adminSignOut();
                }}
              >
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
