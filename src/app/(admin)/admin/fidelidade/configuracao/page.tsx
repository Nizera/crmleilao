import { History, Settings2 } from "lucide-react";
import { requireAdmin } from "@/lib/dal";
import { getAdminLoyaltyData } from "@/lib/loyalty";
import { saveLoyaltySettings } from "@/app/actions/loyalty";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoyaltyAdminShell, LoyaltyField, LoyaltyMigrationWarning, loyaltyDate } from "@/components/admin/loyalty/loyalty-admin-shell";

export const metadata = { title: "Configurações de fidelidade" };

export default async function LoyaltySettingsPage({ searchParams }: PageProps<"/admin/fidelidade/configuracao">) {
  const { profile } = await requireAdmin();
  const params = await searchParams;
  const { settings, history, error } = await getAdminLoyaltyData();
  const query = (key: string) => Array.isArray(params[key]) ? params[key]?.[0] : params[key];
  if (error || !settings) return <LoyaltyAdminShell active="configuracao"><LoyaltyMigrationWarning error={error} /></LoyaltyAdminShell>;
  const canEdit = profile.role !== "viewer";
  return <LoyaltyAdminShell active="configuracao" programActive={settings.active} error={query("erro")} saved={Boolean(query("salvo"))}>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Settings2 className="size-5" /> Regras do programa</CardTitle><CardDescription>Os valores podem ficar em branco até serem definidos. Pontos não entram no saldo em reais, nos gastos do cliente ou no cálculo do frete.</CardDescription></CardHeader><CardContent>
      <form action={saveLoyaltySettings} className="grid max-w-3xl gap-4">
        <div className="rounded-lg border bg-muted/40 p-3 text-sm"><strong>Ganho automático por gasto acumulado em lotes pagos</strong><p className="mt-1 text-xs text-muted-foreground">Lilás: 0,5 pt/R$ 1 (menos de R$ 1.000) · Bronze: 1 pt (R$ 1.000 a menos de R$ 5.000) · Prata: 1,5 pt (R$ 5.000 a menos de R$ 15.000) · Ouro: 2 pts (R$ 15.000 a menos de R$ 25.000) · Crumple: 2,5 pts (R$ 25.000 a menos de R$ 50.000) · Prizm: 3 pts (R$ 50.000 ou mais). Fretes não contam. Todos os lotes pagos no mesmo Pix usam a taxa do elo anterior ao pagamento; os próximos pagamentos usam o novo elo alcançado.</p></div>
        <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">No piloto, os pontos não expiram. Uma política de validade só será liberada quando o sistema puder controlar essa regra no saldo e no resgate.</p>
        <label className="flex items-start gap-3 rounded-lg border p-3 text-sm"><input type="checkbox" name="ranking_enabled" defaultChecked={settings.ranking_enabled} disabled={!canEdit} className="mt-1 accent-yellow-500" /><span><strong>Liberar ranking</strong><span className="mt-0.5 block text-xs text-muted-foreground">Só aparecem clientes que optarem por participar. Nome exibido parcialmente.</span></span></label>
        <LoyaltyField label="Nota da alteração (opcional)"><Input name="note" placeholder="Ex.: configuração inicial / revisão do piloto" disabled={!canEdit} /></LoyaltyField>
        <label className="flex items-center gap-3 rounded-lg border border-ouro/30 bg-amarelo/10 p-3 text-sm font-semibold"><input type="checkbox" name="active" defaultChecked={settings.active} disabled={!canEdit} className="size-4 accent-yellow-500" /> Ativar programa para os clientes</label>
        <p className="text-xs text-muted-foreground">A ativação exige ao menos uma recompensa ativa com preço em pontos e custo interno preenchidos. Frete não gera pontos; cancelamento/estorno do lote reverte os pontos emitidos.</p>
        {canEdit ? <Button type="submit" className="w-fit">Salvar configuração</Button> : <p className="text-sm text-muted-foreground">Perfil somente leitura.</p>}
      </form>
      <div className="mt-6 max-w-3xl border-t pt-4"><h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><History className="size-4" /> Histórico de regras</h3>{history.length === 0 ? <p className="text-xs text-muted-foreground">Nenhuma alteração registrada.</p> : <ul className="grid gap-2">{history.map((item) => <li key={item.id} className="flex flex-wrap justify-between gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs"><span>{item.active ? "Ativado" : "Desligado"} · faixas de pontos por elo · {item.note || "sem nota"}</span><time className="text-muted-foreground">{loyaltyDate(item.effective_at)}</time></li>)}</ul>}</div>
    </CardContent></Card>
  </LoyaltyAdminShell>;
}
