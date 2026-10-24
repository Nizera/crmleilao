import Link from "next/link";
import { Award, Gift, History, LayoutDashboard, PackageCheck, Settings2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const loyaltyNumber = (value: unknown) => new Intl.NumberFormat("pt-BR").format(Number(value ?? 0));
export const loyaltyBRL = (value: unknown) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0));
export const loyaltyDate = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
export const LoyaltyField = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="grid gap-1.5 text-sm"><span className="font-medium">{label}</span>{children}</label>;

const tabs = [
  ["resumo", "/admin/fidelidade", "Resumo", LayoutDashboard],
  ["recompensas", "/admin/fidelidade/recompensas", "Recompensas", Gift],
  ["resgates", "/admin/fidelidade/resgates", "Resgates", PackageCheck],
  ["extrato", "/admin/fidelidade/extrato", "Extrato de pontos", History],
  ["configuracao", "/admin/fidelidade/configuracao", "Configurações", Settings2],
] as const;

export function LoyaltyAdminShell({ active, children, error, saved, programActive }: { active: typeof tabs[number][0]; children: React.ReactNode; error?: string; saved?: boolean; programActive?: boolean }) {
  return <main className="flex flex-col gap-5 p-4 md:p-8">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">Administração <span>/</span> Relacionamento <span>/</span> Fidelidade</div><h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><Award className="size-6 text-amarelo" /> Fidelidade e loja de pontos</h1><p className="mt-1 text-sm text-muted-foreground">Acompanhe o programa, as recompensas e os pontos dos clientes.</p></div>
      {programActive !== undefined && <span className="rounded-full bg-amarelo/15 px-3 py-1.5 text-xs font-semibold text-ouro-ink">● {programActive ? "Programa ativo" : "Rascunho · desligado"}</span>}
    </header>
    <nav aria-label="Seções de fidelidade" className="-mx-1 flex gap-1 overflow-x-auto border-b px-1">
      {tabs.map(([key, href, label, Icon]) => <Link key={key} href={href} aria-current={active === key ? "page" : undefined} className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition-colors ${active === key ? "border-amarelo text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}><Icon className="size-4" />{label}</Link>)}
    </nav>
    {error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>}
    {saved && <div role="status" className="rounded-lg border border-ouro/30 bg-amarelo/10 px-4 py-3 text-sm">Alterações salvas.</div>}
    {children}
  </main>;
}

export function LoyaltyMigrationWarning({ error }: { error?: string | null }) {
  return <Card><CardHeader><CardTitle>O banco ainda não está pronto</CardTitle><CardDescription>A tabela necessária para fidelidade não respondeu. Confira se a migration foi aplicada antes de usar esta seção.</CardDescription></CardHeader><CardContent><code className="rounded bg-muted px-2 py-1 text-xs">supabase/migrations/0019_loyalty_store.sql</code>{error && <p className="mt-3 break-all text-xs text-muted-foreground">Detalhe: {error}</p>}</CardContent></Card>;
}
