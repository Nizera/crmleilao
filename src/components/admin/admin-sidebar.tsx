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
  Gavel,
  Store,
  Ticket,
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

const auctionGroups = [
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

const storeGroups = [{
  label: "Loja",
  items: [
    { title: "Visão geral", url: "/admin/fidelidade", icon: LayoutDashboard, exact: true },
    { title: "Produtos", url: "/admin/fidelidade/recompensas", icon: Gift },
    { title: "Pedidos", url: "/admin/fidelidade/resgates", icon: ShoppingCart },
    { title: "Caracoins", url: "/admin/fidelidade/extrato", icon: History },
    { title: "Configurações", url: "/admin/fidelidade/configuracao", icon: Award },
  ],
}];
const sections = [
  { id: "leilao", title: "Leilão", url: "/admin/dashboard", icon: Gavel },
  { id: "loja", title: "Loja", url: "/admin/fidelidade", icon: Store },
  { id: "rifa", title: "Rifa", url: "/admin/rifa", icon: Ticket },
];

export function AdminSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();
  const section = pathname === "/admin/fidelidade" || pathname.startsWith("/admin/fidelidade/")
    ? "loja" : pathname === "/admin/rifa" || pathname.startsWith("/admin/rifa/") ? "rifa" : "leilao";
  const groups = section === "loja" ? storeGroups : section === "rifa"
    ? [{ label: "Rifa", items: [{ title: "Em breve", url: "/admin/rifa", icon: Ticket }] }]
    : auctionGroups;

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="h-auto min-h-12 py-2" asChild>
              <Link href={sections.find(item => item.id === section)!.url}>
                <LogoMark className="hidden size-8 shrink-0 group-data-[collapsible=icon]:block" />
                <div className="grid min-w-0 gap-1 group-data-[collapsible=icon]:hidden">
                  <Logo className="w-44" />
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <nav aria-label="Seções do painel" className="mt-2 grid grid-cols-3 gap-1 border-b border-sidebar-border pb-3 group-data-[collapsible=icon]:grid-cols-1">
          {sections.map(item => <Link key={item.id} href={item.url}
            aria-current={section === item.id ? "page" : undefined}
            title={item.id === "rifa" ? "Rifa — em breve" : item.title}
            className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-md px-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:min-h-8 ${section === item.id ? "bg-amarelo text-black" : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`}>
            <item.icon className="size-4 shrink-0" />
            <span className="group-data-[collapsible=icon]:sr-only">{item.title}</span>
          </Link>)}
        </nav>
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
