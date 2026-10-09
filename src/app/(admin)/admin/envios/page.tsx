import { requireAdmin } from "@/lib/dal";
import { PlaceholderPage } from "@/components/admin/placeholder-page";

export const metadata = { title: "Envios" };

export default async function EnviosPage() {
  await requireAdmin();

  return (
    <PlaceholderPage
      title="Envios"
      description="Fretes de terça, etiquetas e rastreio via SuperFrete."
      phase="Fase 4"
      items={[
        "Agrupamento dos lotes pagos no lote de envio de terça",
        "Cotação multi-transportadora (Correios, Jadlog, Loggi)",
        "Emissão e pagamento da etiqueta, com PDF para impressão",
        "Atualização de rastreio via webhook SuperFrete",
        "Visão do cliente com pedidos enviados e códigos de rastreio",
      ]}
    />
  );
}
