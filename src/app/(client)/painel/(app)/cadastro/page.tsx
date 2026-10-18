import { redirect } from "next/navigation";

import { PasswordForm } from "@/components/client/password-form";
import { ShippingForm } from "@/components/client/shipping-form";
import { getCustomerShipping, requireCustomer } from "@/lib/dal";

export const metadata = { title: "Meus dados" };

/**
 * Primeiro login (endereço obrigatório) e "Meus dados".
 * O primeiro acesso pelo link de convite manda para cá quando o endereço
 * ainda está incompleto.
 */
export default async function CadastroPage() {
  const { customer } = await requireCustomer();
  const shipping = await getCustomerShipping(customer.id);

  // Migração 0004 ainda não aplicada: volta para o painel comum.
  if (!shipping) redirect("/painel");

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Meus dados</h1>
        <p className="text-sm text-muted-foreground">
          Endereço usado na etiqueta e no rastreio dos seus pacotes, e a senha
          de acesso ao painel.
        </p>
      </div>
      <ShippingForm initial={shipping} />
      <PasswordForm />
    </div>
  );
}
