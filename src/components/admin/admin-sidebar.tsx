"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarClock,
  Coins,
  Boxes,
  Award,
  FileText,
  LayoutDashboard,
  Package,
  Settings,
  Users,
} from "lucide-react";

import { LogoMark } from "@/components/brand/logo";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

const groups = [
  {
    label: "Operação",
    items: [
      { title: "Dashboard", url: "/admin/dashboard", icon: LayoutDashboard },
      { title: "Lotes", url: "/admin/lotes", icon: Package },
      { title: "Envios", url: "/admin/envios", icon: CalendarClock },
      { title: "Relatórios", url: "/admin/relatorios", icon: FileText },
    ],
  },
  {
    label: "Relacionamento",
    items: [
      { title: "Clientes", url: "/admin/clientes", icon: Users },
      { title: "Cobranças", url: "/admin/cobrancas", icon: Coins },
      { title: "Fidelidade", url: "/admin/fidelidade", icon: Award },
    ],
  },
  {
    label: "Inventário",
    items: [{ title: "Estoque", url: "/admin/estoque", icon: Boxes }],
  },
  {
    label: "Sistema",
    items: [
      { title: "Configuração", url: "/admin/configuracao", icon: Settings },
    ],
  },
];

export function AdminSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/admin/dashboard">
                <div className="flex aspect-square size-8 shrink-0 items-center justify-center">
                  <LogoMark className="size-full" />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="text-xs font-extrabold uppercase tracking-wide">
                    <span className="block">Os Caras</span>
                    <span className="block">das Legends</span>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    Painel ADM
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const isActive =
                    pathname === item.url || pathname.startsWith(`${item.url}/`);
                  return (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        tooltip={item.title}
                      >
                        <Link href={item.url}>
                          <item.icon />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}
