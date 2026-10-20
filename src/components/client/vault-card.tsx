import { Lock, ShieldCheck, ShieldPlus } from "lucide-react";

/** Card "Cofre Legends": regra dos 21 dias e confiança (copy do protótipo). */
export function VaultCard() {
  return (
    <section className="rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10">
      <div className="flex items-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-amarelo/15 text-ouro-ink">
          <Lock className="size-[18px]" />
        </span>
        <h2 className="text-sm font-bold">Cofre de Figurinhas Legends</h2>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Você pode acumular arremates por até{" "}
        <strong className="text-ouro-ink">21 dias corridos</strong> sem pagar
        fretes adicionais. Quando decidir despachar, solicite o envio agrupado
        direto no app.
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <ShieldPlus className="size-3.5 text-ouro-ink" />
          Embalagem rígida protetora
        </span>
        <span className="flex items-center gap-1">
          <ShieldCheck className="size-3.5 text-ouro-ink" />
          Seguro total
        </span>
      </div>
    </section>
  );
}
