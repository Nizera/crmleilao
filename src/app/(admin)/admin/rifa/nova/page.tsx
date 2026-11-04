import { requireAdmin } from "@/lib/dal";
import { RaffleCreateForm } from "@/components/raffles/raffle-admin";
export const metadata = { title: "Criar campanha" };
export const instant = false;
export default async function Page() {
  const { profile } = await requireAdmin();
  return <main className="grid min-w-0 gap-6 p-4 md:p-8"><header className="rf-heading"><div><p className="rf-eyebrow mb-2">RIFA / NOVA CAMPANHA</p><h1>Vamos criar sua próxima campanha</h1><p>Primeiro o rascunho. Você revisa e publica quando estiver tudo pronto.</p></div></header>{profile.role === "viewer" ? <p>Seu perfil permite apenas consultar campanhas.</p> : <RaffleCreateForm />}</main>;
}
