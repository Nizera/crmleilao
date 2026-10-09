import { redirect } from "next/navigation";

import { ShippingForm } from "@/components/client/shipping-form";
import { getCustomerShipping, requireCustomer } from "@/lib/dal";

export const metadata = { title: "Dados para envio" };

/**
 * Primeiro login (endereço obrigatório) e "Meus dados".
 * O guard de verifyCustomerOtp manda para cá quando o endereço está incompleto.
 */
export default async function CadastroPage() {
  const { customer } = await requireCustomer();
  const shipping = await getCustomerShipping(customer.id);

  // Migração 0004 ainda não aplicada: volta para o painel comum.
  if (!shipping) redirect("/painel");

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Dados para envio
        </h1>
        <p className="text-sm text-muted-foreground">
          Falta pouco: o endereço completo é usado na etiqueta e no rastreio
          dos seus pacotes.
        </p>
      </div>
      <ShippingForm initial={shipping} />
    </div>
  );
}
