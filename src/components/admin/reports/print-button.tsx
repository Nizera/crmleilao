"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Abre a caixa de impressão do navegador sobre o conteúdo visível da página. */
export function PrintButton(props: React.ComponentProps<typeof Button>) {
  return (
    <Button type="button" onClick={() => window.print()} {...props}>
      <Printer />
      Imprimir
    </Button>
  );
}
