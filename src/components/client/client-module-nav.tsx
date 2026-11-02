"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Gavel, Store, Ticket } from "lucide-react";
export function ClientModuleNav() {
  const path = usePathname();
  const section = path.startsWith("/painel/loja") ? "loja" : path.startsWith("/painel/rifas") ? "rifas" : "leilao";
  return <nav aria-label="Áreas do aplicativo" className="mb-5 grid grid-cols-3 gap-2 rounded-xl border bg-card p-1">{[
    { id: "leilao", label: "Leilão", href: "/painel", icon: Gavel },
    { id: "loja", label: "Loja", href: "/painel/loja", icon: Store },
    { id: "rifas", label: "Rifas", href: "/painel/rifas", icon: Ticket },
  ].map(t => <Link key={t.id} href={t.href} aria-current={section === t.id ? "page" : undefined} className={`flex min-h-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold ${section === t.id ? "bg-amarelo text-black" : "text-muted-foreground hover:bg-muted"}`}><t.icon className="size-4" />{t.label}</Link>)}</nav>;
}
