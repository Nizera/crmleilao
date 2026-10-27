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
  Gift,
  ShoppingCart,
  History,
} from "lucide-react";

import { Logo, LogoMark } from "@/components/brand/logo";
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
    ],
  },
  {
    label: "Loja",
    items: [
      { title: "Visão geral", url: "/admin/fidelidade", icon: LayoutDashboard, exact: true },
      { title: "Produtos", url: "/admin/fidelidade/recompensas", icon: Gift },
      { title: "Pedidos", url: "/admin/fidelidade/resgates", icon: ShoppingCart },
      { title: "Caracoins", url: "/admin/fidelidade/extrato", icon: History },
      { title: "Configurações", url: "/admin/fidelidade/configuracao", icon: Award },
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
            <SidebarMenuButton size="lg" className="h-auto min-h-12 py-2" asChild>
              <Link href="/admin/dashboard">
                <LogoMark className="hidden size-8 shrink-0 group-data-[collapsible=icon]:block" />
                <div className="grid min-w-0 gap-1 group-data-[collapsible=icon]:hidden">
                  <Logo className="w-44" />
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
                    pathname === item.url || (!("exact" in item && item.exact) && pathname.startsWith(`${item.url}/`));
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
