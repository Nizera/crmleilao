import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { RaffleSettings } from "@/components/raffles/raffle-admin";
import { RaffleUnavailable } from "@/components/raffles/raffle-shared";
import { Clock3, Gift, ShieldCheck } from "lucide-react";
export const metadata = { title: "Configurações de rifas" };
export const instant = false;
export default async function Page() {
  const { profile } = await requireAdmin();
  const { data, error } = await (await createClient()).from("raffle_settings").select("purchases_enabled").eq("id", true).single();
  return <main className="grid gap-5 p-4 md:p-8"><header className="rf-heading"><div><p className="rf-eyebrow mb-2">RIFA / CONFIGURAÇÕES</p><h1>Configurações de rifas</h1><p>Controle novas compras e entenda as regras que protegem cada participação.</p></div></header>{error ? <RaffleUnavailable /> : <RaffleSettings enabled={data.purchases_enabled} owner={profile.role === "owner"} />}<div className="grid items-start gap-4 lg:grid-cols-3">{[{ icon: Clock3, title: "Reservas de 10 minutos", text: "As cotas só são liberadas depois que o Mercado Pago confirma o cancelamento do Pix." }, { icon: ShieldCheck, title: "Pagamento confirmado", text: "A participação é efetivada após a confirmação do provedor. Apenas marcar o tempo na tela não libera cotas." }, { icon: Gift, title: "Prêmios no mesmo cadastro", text: "Prêmios principais e cotas premiadas seguem para Meus prêmios e para a fila de separação do cliente." }].map(item => <section key={item.title} className="rf-panel grid gap-3"><span className="rf-icon-tile"><item.icon size={20} /></span><h2 className="text-sm font-semibold">{item.title}</h2><p className="rf-caption">{item.text}</p></section>)}</div></main>;
}
