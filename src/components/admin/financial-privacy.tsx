"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";

const HiddenValues = createContext(false);

/** Discrição visual para apresentações; não altera permissões nem os dados. */
export function FinancialPrivacy({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(false);
  return <HiddenValues.Provider value={hidden}>
    <div className="flex justify-end px-4 pt-3 md:px-6">
      <Button type="button" variant="outline" size="sm" aria-pressed={hidden}
        aria-label={hidden ? "Mostrar valores financeiros" : "Ocultar valores financeiros"}
        onClick={() => setHidden(value => !value)}>
        {hidden ? <EyeOff size={16} /> : <Eye size={16} />}
        {hidden ? "Mostrar valores" : "Ocultar valores"}
      </Button>
    </div>
    {children}
  </HiddenValues.Provider>;
}

export function FinancialValue({ children }: { children: ReactNode }) {
  const hidden = useContext(HiddenValues);
  return hidden ? <span aria-label="Valor oculto">••••</span> : <>{children}</>;
}
