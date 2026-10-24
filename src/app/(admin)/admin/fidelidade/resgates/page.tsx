import { PackageCheck } from "lucide-react";
import { requireAdmin } from "@/lib/dal";
import { getAdminLoyaltyData } from "@/lib/loyalty";
import { handleLoyaltyRedemption } from "@/app/actions/loyalty";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { LoyaltyAdminShell, LoyaltyMigrationWarning, loyaltyDate, loyaltyNumber } from "@/components/admin/loyalty/loyalty-admin-shell";

export const metadata = { title: "Resgates de fidelidade" };

export default async function LoyaltyRedemptionsPage({ searchParams }: PageProps<"/admin/fidelidade/resgates">) {
  const { profile } = await requireAdmin();
  const params = await searchParams;
  const { settings, redemptions, error } = await getAdminLoyaltyData();
  const query = (key: string) => Array.isArray(params[key]) ? params[key]?.[0] : params[key];
  if (error || !settings) return <LoyaltyAdminShell active="resgates"><LoyaltyMigrationWarning error={error} /></LoyaltyAdminShell>;
  const canEdit = profile.role !== "viewer";
  const pendingCount = redemptions.filter((item) => item.status === "pending").length;
  return <LoyaltyAdminShell active="resgates" programActive={settings.active} error={query("erro")} saved={Boolean(query("salvo"))}>
    <header><h2 className="flex items-center gap-2 text-xl font-semibold"><PackageCheck className="size-5" /> Pedidos de resgate {pendingCount > 0 && <span className="rounded-full bg-amarelo/20 px-2 py-0.5 text-xs">{pendingCount} pendente(s)</span>}</h2><p className="text-sm text-muted-foreground">Revise os pedidos e registre aprovação, conclusão ou recusa.</p></header>
    <div className="grid gap-3">{redemptions.length === 0 ? <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhum resgate solicitado.</p> : redemptions.map((item) => { const customer = Array.isArray(item.customer) ? item.customer[0] : item.customer; return <Card key={item.id} size="sm"><CardContent className="grid gap-3 pt-3 md:grid-cols-[1fr_auto] md:items-center"><div className="min-w-0"><p className="font-semibold">{item.reward_name} <span className="font-normal text-muted-foreground">· {loyaltyNumber(item.points_cost)} pts</span></p><p className="text-sm">{customer?.name || "Cliente"} · {customer?.phone_e164 || ""}</p><p className="text-xs text-muted-foreground">{loyaltyDate(item.created_at)} · {item.status}{item.customer_note ? ` · ${item.customer_note}` : ""}</p>{item.admin_note && <p className="text-xs text-muted-foreground">Nota da equipe: {item.admin_note}</p>}</div>{canEdit && item.status !== "fulfilled" && item.status !== "rejected" && <form action={handleLoyaltyRedemption} className="flex flex-wrap items-center gap-2"><input type="hidden" name="redemption_id" value={item.id} /><Input name="admin_note" placeholder="Nota opcional" className="w-36" /><Button name="status" value="approved" size="sm" variant="outline">Aprovar</Button><Button name="status" value="fulfilled" size="sm">Concluir</Button><Button name="status" value="rejected" size="sm" variant="destructive">Recusar</Button></form>}</CardContent></Card>; })}</div>
    {!canEdit && <p className="text-sm text-muted-foreground">Perfil somente leitura.</p>}
  </LoyaltyAdminShell>;
}
