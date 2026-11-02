import { requireAdmin } from "@/lib/dal";
import { RaffleCreateForm } from "@/components/raffles/raffle-admin";
export const metadata = { title: "Criar campanha" };
export const instant = false;
export default async function Page() {
  const { profile } = await requireAdmin();
  return <main className="mx-auto grid w-full max-w-4xl gap-6 p-4 md:p-8"><h1 className="text-2xl font-bold">Criar rifa</h1>{profile.role === "viewer" ? <p>Seu perfil permite apenas consultar campanhas.</p> : <RaffleCreateForm />}</main>;
}
