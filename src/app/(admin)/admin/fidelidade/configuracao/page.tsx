import { History, Settings2, Sparkles, TriangleAlert } from "lucide-react";
import { requireAdmin } from "@/lib/dal";
import { getAdminLoyaltyData } from "@/lib/loyalty";
import { saveLoyaltySettings } from "@/app/actions/loyalty";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoyaltyAdminShell, LoyaltyField, LoyaltyMigrationWarning, loyaltyDate } from "@/components/admin/loyalty/loyalty-admin-shell";
import { LOYALTY_TIERS } from "@/lib/loyalty-tiers";

export const metadata = { title: "Configurações de fidelidade" };

export default async function LoyaltySettingsPage({ searchParams }: PageProps<"/admin/fidelidade/configuracao">) {
  const { profile } = await requireAdmin();
  const params = await searchParams;
  const { settings, history, error } = await getAdminLoyaltyData();
  const query = (key: string) => Array.isArray(params[key]) ? params[key]?.[0] : params[key];
  if (error || !settings) return <LoyaltyAdminShell active="configuracao"><LoyaltyMigrationWarning error={error} /></LoyaltyAdminShell>;
  const canEdit = profile.role !== "viewer";
  return <LoyaltyAdminShell active="configuracao" programActive={settings.active} error={query("erro")} saved={Boolean(query("salvo"))}>
    {settings.points_per_real !== null && <div role="alert" className="flex gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm"><TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-600" /><div><strong>Regra antiga ainda gravada no banco</strong><p className="mt-1 text-muted-foreground">Está configurado {settings.points_per_real} ponto(s) por real. A migration 0022 remove essa taxa, recalcula os créditos históricos e mantém um ajuste auditável no extrato. Até ela ser aplicada, a conta exibida pode não refletir a regra nova.</p></div></div>}
    <section className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="size-5" /> Ganho de pontos por elo</CardTitle><CardDescription>A taxa é determinada pelos pontos ganhos em lotes pagos. O saldo de pontos usado em resgates é independente do elo.</CardDescription></CardHeader><CardContent className="grid gap-3">
        <div className="grid gap-2 sm:grid-cols-2">{LOYALTY_TIERS.map((tier) => <div key={tier.key} className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3"><div><p className="font-semibold">{tier.name}</p><p className="text-xs text-muted-foreground">{tier.range}</p></div><span className="shrink-0 text-sm font-semibold">{tier.rate}</span></div>)}</div>
        <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">A faixa é calculada pelos pontos de lotes pagos, menos estornos. Pontos resgatados não rebaixam o elo. Fretes não geram pontos. Lotes pagos no mesmo Pix usam a mesma taxa, definida antes de processar o pagamento.</p>
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Settings2 className="size-5" /> Controles do programa</CardTitle><CardDescription>As taxas são padronizadas pelo elo e não podem ser substituídas por uma taxa global.</CardDescription></CardHeader><CardContent>
        <form action={saveLoyaltySettings} className="grid gap-4">
          <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">Os pontos ficam separados do saldo em reais, dos gastos do cliente e do cálculo do frete. No piloto, os pontos não expiram.</p>
          <label className="flex items-start gap-3 rounded-lg border p-3 text-sm"><input type="checkbox" name="ranking_enabled" defaultChecked={settings.ranking_enabled} disabled={!canEdit} className="mt-1 accent-yellow-500" /><span><strong>Liberar ranking</strong><span className="mt-0.5 block text-xs text-muted-foreground">Só aparecem clientes que optarem por participar. Nome exibido parcialmente.</span></span></label>
          <LoyaltyField label="Nota da alteração (opcional)"><Input name="note" placeholder="Ex.: revisão da política de pontos" disabled={!canEdit} /></LoyaltyField>
          <label className="flex items-start gap-3 rounded-lg border border-ouro/30 bg-amarelo/10 p-3 text-sm font-semibold"><input type="checkbox" name="active" defaultChecked={settings.active} disabled={!canEdit} className="mt-1 size-4 accent-yellow-500" /><span>Ativar programa para os clientes<span className="mt-1 block text-xs font-normal text-muted-foreground">Exige um produto ativo com ao menos uma modalidade de preço e custo interno preenchidos.</span></span></label>
          <p className="text-xs text-muted-foreground">Cancelar ou estornar um lote reverte os pontos correspondentes. As taxas por elo são fixas nesta configuração.</p>
          {canEdit ? <Button type="submit" className="w-fit">Salvar configuração</Button> : <p className="text-sm text-muted-foreground">Perfil somente leitura.</p>}
        </form>
      </CardContent></Card>
    </section>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><History className="size-5" /> Histórico de regras</CardTitle><CardDescription>Registro das ativações e notas administrativas.</CardDescription></CardHeader><CardContent>{history.length === 0 ? <p className="text-xs text-muted-foreground">Nenhuma alteração registrada.</p> : <ul className="grid gap-2">{history.map((item) => <li key={item.id} className="flex flex-wrap justify-between gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs"><span>{item.active ? "Ativado" : "Desligado"} · taxas por faixa de pontos · {item.note || "sem nota"}</span><time className="text-muted-foreground">{loyaltyDate(item.effective_at)}</time></li>)}</ul>}</CardContent></Card>
  </LoyaltyAdminShell>;
}
