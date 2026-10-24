import { Gift } from "lucide-react";
import { requireAdmin } from "@/lib/dal";
import { getAdminLoyaltyData } from "@/lib/loyalty";
import { saveLoyaltyReward } from "@/app/actions/loyalty";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoyaltyAdminShell, LoyaltyField, LoyaltyMigrationWarning, loyaltyBRL, loyaltyNumber } from "@/components/admin/loyalty/loyalty-admin-shell";

export const metadata = { title: "Recompensas de fidelidade" };

export default async function LoyaltyRewardsPage({ searchParams }: PageProps<"/admin/fidelidade/recompensas">) {
  const { profile } = await requireAdmin();
  const params = await searchParams;
  const { settings, rewards, stats, error } = await getAdminLoyaltyData();
  const query = (key: string) => Array.isArray(params[key]) ? params[key]?.[0] : params[key];
  if (error || !settings) return <LoyaltyAdminShell active="recompensas"><LoyaltyMigrationWarning error={error} /></LoyaltyAdminShell>;
  const canEdit = profile.role !== "viewer";
  return <LoyaltyAdminShell active="recompensas" programActive={settings.active} error={query("erro")} saved={Boolean(query("salvo"))}>
    <section className="grid gap-4"><header><h2 className="flex items-center gap-2 text-xl font-semibold"><Gift className="size-5 text-ouro-ink" /> Catálogo de recompensas</h2><p className="text-sm text-muted-foreground">O custo interno fica reservado à equipe; o preço em pontos aparece para o cliente.</p></header>
      <div className="grid gap-3 sm:grid-cols-3"><Card size="sm"><CardContent className="pt-3"><p className="text-xs text-muted-foreground">Itens cadastrados</p><p className="text-lg font-semibold">{loyaltyNumber(rewards.length)}</p></CardContent></Card><Card size="sm"><CardContent className="pt-3"><p className="text-xs text-muted-foreground">Disponíveis no catálogo</p><p className="text-lg font-semibold">{loyaltyNumber(rewards.filter((reward) => reward.active).length)}</p></CardContent></Card><Card size="sm"><CardContent className="pt-3"><p className="text-xs text-muted-foreground">Custo conhecido em estoque</p><p className="text-lg font-semibold">{loyaltyBRL(stats?.inventory_cost)}</p></CardContent></Card></div>
      {rewards.map((reward) => <Card key={reward.id}><CardHeader><CardTitle className="text-base">{reward.name}</CardTitle><CardDescription>{reward.active ? "Disponível no catálogo" : "Oculta dos clientes"}{reward.points_cost != null ? ` · ${loyaltyNumber(reward.points_cost)} pts` : " · preço a definir"}</CardDescription></CardHeader><CardContent><form action={saveLoyaltyReward} className="grid gap-3"><input type="hidden" name="id" value={reward.id} />
        <div className="grid gap-3 sm:grid-cols-2"><LoyaltyField label="Nome"><Input name="name" defaultValue={reward.name} required minLength={2} maxLength={120} disabled={!canEdit} /></LoyaltyField><LoyaltyField label="Descrição"><Input name="description" defaultValue={reward.description ?? ""} placeholder="Como o cliente recebe ou utiliza" disabled={!canEdit} /></LoyaltyField></div>
        <div className="grid gap-3 sm:grid-cols-3"><LoyaltyField label="Preço (pontos)"><Input name="points_cost" type="number" min="1" step="1" placeholder="A definir" defaultValue={reward.points_cost ?? ""} disabled={!canEdit} /></LoyaltyField><LoyaltyField label="Custo interno (R$)"><Input name="internal_cost" type="number" min="0" step="0.01" placeholder="A definir" defaultValue={reward.internal_cost ?? ""} disabled={!canEdit} /></LoyaltyField><LoyaltyField label="Estoque (vazio = sem limite)"><Input name="stock" type="number" min="0" step="1" placeholder="Sem limite" defaultValue={reward.stock ?? ""} disabled={!canEdit} /></LoyaltyField></div>
        <div className="flex flex-wrap items-center justify-between gap-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={reward.active} disabled={!canEdit} className="accent-yellow-500" /> Disponível no catálogo</label>{canEdit && <Button type="submit" size="sm" variant="outline">Salvar recompensa</Button>}</div>
      </form></CardContent></Card>)}
      {rewards.length === 0 && <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhuma recompensa cadastrada.</p>}
      {canEdit && <Card className="border-dashed"><CardHeader><CardTitle className="text-base">Nova recompensa</CardTitle><CardDescription>Preço e custo podem ficar em branco enquanto o programa estiver desligado.</CardDescription></CardHeader><CardContent><form action={saveLoyaltyReward} className="grid gap-3"><div className="grid gap-3 sm:grid-cols-2"><LoyaltyField label="Nome"><Input name="name" required minLength={2} maxLength={120} placeholder="Ex.: desconto em próximo lote" /></LoyaltyField><LoyaltyField label="Descrição"><Input name="description" placeholder="Detalhes para o cliente" /></LoyaltyField></div><div className="grid gap-3 sm:grid-cols-3"><LoyaltyField label="Preço em pontos"><Input name="points_cost" type="number" min="1" step="1" placeholder="A definir" /></LoyaltyField><LoyaltyField label="Custo interno (R$)"><Input name="internal_cost" type="number" min="0" step="0.01" placeholder="A definir" /></LoyaltyField><LoyaltyField label="Estoque"><Input name="stock" type="number" min="0" step="1" placeholder="Sem limite" /></LoyaltyField></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" className="accent-yellow-500" /> Disponível no catálogo</label><Button type="submit" className="w-fit">Cadastrar recompensa</Button></form></CardContent></Card>}
    </section>
  </LoyaltyAdminShell>;
}
