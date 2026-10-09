import { connection } from "next/server";
import { requireCustomer } from "@/lib/dal";
import { ClientHeader } from "@/components/client/client-header";

// Rotas autenticadas leem cookies() na request e não entram no shell estático.
export const instant = false;

export default async function ClientLayout({
  children,
}: LayoutProps<"/painel">) {
  await connection();
  const { customer } = await requireCustomer();

  return (
    <div className="flex min-h-svh flex-col bg-muted/40">
      <ClientHeader name={customer.name} phone={customer.phone_e164} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 md:px-6 md:py-8">
        {children}
      </main>
      <footer className="border-t bg-background py-4 text-center text-xs text-muted-foreground">
        Caras das Legends · Leilão de figurinhas Copa 2026
      </footer>
    </div>
  );
}
