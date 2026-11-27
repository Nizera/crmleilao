import { Suspense } from "react";
import {MarketingPreferencesLink} from "@/components/client/marketing-preferences-link";
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

import styles from "./promotion.module.css";

const blackFridayMessage = "Black Friday - Todos os lotes com 30% OFF";

// Rotas autenticadas leem cookies() na request e não entram no shell estático.
export const instant = false;

export default async function ClientLayout({
  children,
}: LayoutProps<"/painel">) {
  await connection();
  const { customer } = await requireCustomer();


  return (
    <div className="flex min-h-svh flex-col">
      <div className="sticky top-0 z-40 shrink-0">
        <Suspense fallback={<div role="status" aria-label="Carregando cabeçalho" className="sticky top-0 z-40 h-[calc(4rem+env(safe-area-inset-top,0px))] shrink-0 animate-pulse border-b bg-background" />}>
          <CustomerPanelHeader customer={customer} />
        </Suspense>
        <div className="w-full shrink-0 overflow-hidden bg-black py-2 text-xs font-bold uppercase tracking-wide text-white dark:bg-white dark:text-black">
          <p className="sr-only motion-reduce:not-sr-only motion-reduce:px-3 motion-reduce:text-center">
            {blackFridayMessage}
          </p>
          <div aria-hidden="true" className={`${styles.promotionTrack} motion-reduce:hidden`}>
            {Array.from({ length: 10 }, (_, index) => (
              <span key={index} className={styles.promotionItem}>
                {blackFridayMessage}
              </span>
            ))}
          </div>
        </div>
      </div>
      <main className="mx-auto w-full max-w-2xl has-[.store-page]:max-w-7xl flex-1 px-4 pb-24 pt-6">
        <ClientModuleNav />
        {(customer.warning_count??0)>0&&<aside role="status" className="mb-4 rounded-xl border border-amber-400/50 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"><strong>Você tem {customer.warning_count} de 3 advertências.</strong><p>Lotes cancelados por falta de pagamento após o prazo de pagamento geram uma advertência por dia de leilão, independentemente da quantidade de lotes. Na terceira, seu acesso será bloqueado até a equipe liberar.</p></aside>}
        {children}
        <footer className="mt-10 border-t border-ouro/20 pt-4 text-center text-xs text-muted-foreground">
          Os Caras das Legends · Leilão diário de colecionáveis
        <div className="mt-3"><MarketingPreferencesLink/></div></footer>
      </main>
      <ClientBottomNav />
    </div>
  );
}

async function CustomerPanelHeader({ customer }: { customer: { id: string; name: string | null; phone_e164: string } }) {
  const [notifications, unreadCount, caracoins] = await Promise.all([
    listCustomerNotifications(customer.id),
    countCustomerUnreadNotifications(customer.id),
    getCustomerCaracoinsBalance(customer.id),
  ]);

  return <ClientHeader name={customer.name} phone={customer.phone_e164} notifications={notifications} unreadCount={unreadCount} caracoins={caracoins} />;
}
