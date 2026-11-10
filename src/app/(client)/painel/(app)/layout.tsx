import { connection } from "next/server";
import {
  countCustomerUnreadNotifications,
  listCustomerNotifications,
  requireCustomer,
} from "@/lib/dal";
import { ClientHeader } from "@/components/client/client-header";
import { ClientBottomNav } from "@/components/client/client-bottom-nav";
import { getCustomerCaracoinsBalance } from "@/lib/loyalty";
import { ClientModuleNav } from "@/components/client/client-module-nav";

// Rotas autenticadas leem cookies() na request e não entram no shell estático.
export const instant = false;

export default async function ClientLayout({
  children,
}: LayoutProps<"/painel">) {
  await connection();
  const { customer } = await requireCustomer();

  const [notifications, unreadCount, caracoins] = await Promise.all([
    listCustomerNotifications(customer.id),
    countCustomerUnreadNotifications(customer.id),
    getCustomerCaracoinsBalance(customer.id),
  ]);

  return (
    <div className="flex min-h-svh flex-col">
      <ClientHeader
        name={customer.name}
        phone={customer.phone_e164}
        notifications={notifications}
        unreadCount={unreadCount}
        caracoins={caracoins}
      />
      <main className="mx-auto w-full max-w-2xl has-[.store-page]:max-w-7xl flex-1 px-4 pb-24 pt-6">
        <ClientModuleNav />
        {(customer.warning_count??0)>0&&<aside role="status" className="mb-4 rounded-xl border border-amber-400/50 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"><strong>Você tem {customer.warning_count} de 3 advertências.</strong><p>Lotes cancelados por falta de pagamento após 24h geram uma advertência por dia de leilão, independentemente da quantidade de lotes. Na terceira, seu acesso será bloqueado até a equipe liberar.</p></aside>}
        {children}
        <footer className="mt-10 border-t border-ouro/20 pt-4 text-center text-xs text-muted-foreground">
          Os Caras das Legends · Leilão diário de colecionáveis
        </footer>
      </main>
      <ClientBottomNav />
    </div>
  );
}
