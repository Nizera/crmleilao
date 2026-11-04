"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { lookupRaffleBuyer, recordRaffleWinner } from "@/app/actions/raffles";
import { quotaLabel, type Raffle } from "@/lib/raffles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function RaffleWinnerForm({ campaign, prize, awarded }: { campaign: Raffle; prize: { id: string; title: string }; awarded: boolean }) {
  const [raw, setRaw] = useState("");
  const [lookup, setLookup] = useState<{ raw: string; name?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const valid = /^\d{1,4}$/.test(raw) && Number(raw) < campaign.total_numbers;
  const buyer = lookup?.raw === raw ? lookup : null;
  useEffect(() => {
    if (!valid || awarded) return;
    let disposed = false;
    const timer = setTimeout(async () => {
      try {
        const result = await lookupRaffleBuyer(campaign.id, Number(raw));
        if (disposed) return;
        setLookup({ raw, ...(result.ok && result.data ? { name: result.data.name } : { error: result.ok ? "Esta cota não possui pagamento confirmado." : result.error }) });
      } catch { if (!disposed) setLookup({ raw, error: "Não foi possível consultar agora. Digite a cota novamente para tentar." }); }
    }, 500);
    return () => { disposed = true; clearTimeout(timer); };
  }, [raw, valid, campaign.id, awarded]);
  return <form className="grid min-w-0 gap-4 rounded-xl border bg-card p-4 sm:p-5" onSubmit={event => {
    event.preventDefault();
    if (!valid || !buyer?.name || pending) return;
    if (!confirm(`Confirmar ${buyer.name} como ganhador da cota ${quotaLabel(Number(raw), campaign.total_numbers)}? O resultado não poderá ser sobrescrito.`)) return;
    const form = new FormData(event.currentTarget);
    start(async () => {
      const result = await recordRaffleWinner({ prize: prize.id, number: Number(raw), note: String(form.get("note")) });
      if (!result.ok) toast.error(result.error);
      else { toast.success("Ganhador confirmado. O prêmio já está no painel e na separação do cliente."); router.refresh(); }
    });
  }}><div className="rf-stepper" aria-label="Etapas da apuração">{["Cota", "Conferência", "Confirmação"].map((label, index) => <div key={label} className={`rf-step ${index === (pending ? 2 : buyer?.name ? 1 : 0) ? "is-current" : ""}`}><span>{index + 1}</span>{label}</div>)}</div><h3 className="border-t pt-4 text-base font-semibold">{prize.title}</h3>
    {awarded ? <p className="text-sm">Resultado registrado. O prêmio está vinculado ao ganhador.</p> : <>
      <label className="grid gap-2 text-sm font-medium">Cota vencedora<Input inputMode="numeric" pattern="[0-9]+" maxLength={4} value={raw} disabled={pending} onChange={event => { setRaw(event.target.value); setLookup(null); }} required /><span className="text-xs font-normal text-muted-foreground">Você pode digitar 0 ou 000, 1 ou 001.</span></label>
      <div role="status" aria-live="polite" className={`rounded-xl border p-4 text-sm ${buyer?.name ? "border-emerald-500/25 bg-emerald-500/5" : "bg-muted"}`}>{!raw ? "Digite a cota para identificar o comprador." : !valid ? "Informe uma cota dentro do intervalo da campanha." : buyer?.name ? <><strong className="text-base">{buyer.name}</strong><p className="mt-1 text-emerald-700 dark:text-emerald-400">Cota {quotaLabel(Number(raw), campaign.total_numbers)} · Pagamento confirmado</p></> : buyer?.error || "Consultando comprador…"}</div>
      <label className="grid gap-2 text-sm font-medium">Concurso, regra aplicada ou detalhes<Textarea name="note" minLength={10} maxLength={2000} rows={4} placeholder="Descreva como o resultado foi apurado (mínimo de 10 caracteres)." required disabled={pending} /></label>
      <p className="rounded-lg bg-ouro/5 p-3 text-xs leading-relaxed text-muted-foreground">Ao confirmar, o prêmio entra em Meus prêmios e na fila de separação do cliente. O resultado não poderá ser sobrescrito.</p>
      <Button className="min-h-11" disabled={pending || !valid || !buyer?.name || campaign.status !== "paused"}>{pending ? "Registrando…" : "Confirmar ganhador"}</Button>
    </>}
  </form>;
}
