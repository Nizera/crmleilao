import { connection } from "next/server";
import {
  countCustomerUnreadNotifications,
  getCustomerSpendingSummary,
  listCustomerNotifications,
  requireCustomer,
} from "@/lib/dal";
import { ClientHeader } from "@/components/client/client-header";
import { ClientBottomNav } from "@/components/client/client-bottom-nav";

// Rotas autenticadas leem cookies() na request e não entram no shell estático.
export const instant = false;

export default async function ClientLayout({
  children,
}: LayoutProps<"/painel">) {
  await connection();
  const { customer } = await requireCustomer();

  const [notifications, unreadCount, spending] = await Promise.all([
    listCustomerNotifications(customer.id),
    countCustomerUnreadNotifications(customer.id),
    getCustomerSpendingSummary(customer.id),
  ]);

  return (
    <div className="flex min-h-svh flex-col">
      <ClientHeader
        name={customer.name}
        phone={customer.phone_e164}
        notifications={notifications}
        unreadCount={unreadCount}
        paidTotal={spending.paidTotal}
        openAmount={spending.openAmount}
      />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-24 pt-6">
        {children}
        <footer className="mt-10 border-t border-ouro/20 pt-4 text-center text-xs text-muted-foreground">
          Os Caras das Legends · Leilão de figurinhas Copa 2026
        </footer>
      </main>
      <ClientBottomNav />
    </div>
  );
}
