import { Coins } from "lucide-react";
import { requireAdmin } from "@/lib/dal";
import { getAdminLoyaltyData } from "@/lib/loyalty";
import { adjustLoyaltyPoints } from "@/app/actions/loyalty";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoyaltyAdminShell, LoyaltyField, LoyaltyMigrationWarning, loyaltyBRL, loyaltyDate, loyaltyNumber } from "@/components/admin/loyalty/loyalty-admin-shell";

export const metadata = { title: "Extrato de pontos" };

export default async function LoyaltyLedgerPage({ searchParams }: PageProps<"/admin/fidelidade/extrato">) {
  const { profile } = await requireAdmin();
  const params = await searchParams;
  const { settings, ledger, customers, stats, error } = await getAdminLoyaltyData();
  const query = (key: string) => Array.isArray(params[key]) ? params[key]?.[0] : params[key];
  if (error || !settings) return <LoyaltyAdminShell active="extrato"><LoyaltyMigrationWarning error={error} /></LoyaltyAdminShell>;
  const canEdit = profile.role !== "viewer";
  return <LoyaltyAdminShell active="extrato" programActive={settings.active} error={query("erro")} saved={Boolean(query("salvo"))}>
    <section className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Coins className="size-5" /> Movimentações de pontos</CardTitle><CardDescription>Créditos por lotes pagos, estornos e ajustes administrativos. Pagamentos e fretes não aparecem aqui.</CardDescription></CardHeader><CardContent className="grid gap-3">{ledger.length === 0 ? <p className="text-sm text-muted-foreground">Ainda não há movimentações.</p> : ledger.map((row) => { const customer = Array.isArray(row.customer) ? row.customer[0] : row.customer; return <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 text-sm last:border-0"><div className="min-w-0"><p className="font-medium">{customer?.name || "Cliente"} <span className="text-xs text-muted-foreground">· {row.kind}</span></p><p className="text-xs text-muted-foreground">{loyaltyDate(row.created_at)} · {row.note || "—"}{row.lot_value != null && row.earn_rate != null ? ` · ${loyaltyBRL(row.lot_value)} × ${row.earn_rate} pts/R$` : ""}</p></div><span className={row.points > 0 ? "shrink-0 font-semibold text-emerald-600" : "shrink-0 font-semibold text-destructive"}>{row.points > 0 ? "+" : ""}{loyaltyNumber(row.points)} pts</span></div>; })}</CardContent></Card>
      <div className="grid min-w-0 content-start gap-5"><Card><CardHeader><CardTitle>Indicadores de custo</CardTitle><CardDescription>Estimativa baseada em recompensas com custo e estoque finito informados.</CardDescription></CardHeader><CardContent className="grid gap-2 text-sm"><div className="flex justify-between gap-3"><span className="text-muted-foreground">Custo conhecido em estoque</span><strong>{loyaltyBRL(stats?.inventory_cost)}</strong></div><p className="text-xs text-muted-foreground">Itens sem limite de estoque não entram nesta estimativa.</p></CardContent></Card>
        <Card className="min-w-0 overflow-hidden"><CardHeader><CardTitle>Ajuste manual</CardTitle><CardDescription>Qualquer correção fica registrada neste extrato e exige motivo.</CardDescription></CardHeader><CardContent>{canEdit ? <form action={adjustLoyaltyPoints} className="grid min-w-0 gap-3"><LoyaltyField label="Cliente"><select name="customer_id" required className="h-9 w-full min-w-0 max-w-full rounded-lg border bg-background px-2 text-sm">{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name || "Sem nome"} · {customer.phone_e164}</option>)}</select></LoyaltyField><LoyaltyField label="Pontos (+ credita / − debita)"><Input name="points" type="number" step="1" required placeholder="Ex.: 25 ou -25" className="w-full min-w-0" /></LoyaltyField><LoyaltyField label="Motivo"><Textarea name="note" minLength={4} maxLength={500} required placeholder="Descreva o motivo deste ajuste" className="w-full min-w-0" /></LoyaltyField><Button type="submit" variant="outline" className="w-fit">Registrar ajuste</Button></form> : <p className="text-sm text-muted-foreground">Perfil somente leitura.</p>}</CardContent></Card>
      </div>
    </section>
  </LoyaltyAdminShell>;
}
