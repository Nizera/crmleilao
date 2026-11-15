"use client";
import { useState, useTransition } from "react";
import { Dialog } from "radix-ui";
import { Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { editRaffleCampaign } from "@/app/actions/raffles";
import type { Raffle } from "@/lib/raffles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function RaffleCampaignEditor({ campaign: c }: { campaign: Raffle }) {
  const [open, setOpen] = useState(false), [pending, start] = useTransition();
  const [error, setError] = useState("");
  const router = useRouter();
  if (c.archived_at || !["draft", "paused"].includes(c.status)) return null;
  const field = "grid min-w-0 gap-2 text-sm font-medium";
  const select = "h-10 rounded-md border bg-background px-3 text-sm";
  return <Dialog.Root open={open} onOpenChange={value => { if (!pending) { setOpen(value); setError(""); } }}><Dialog.Trigger asChild><Button variant="outline"><Pencil size={15} />Editar campanha</Button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" /><Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border bg-background shadow-xl"><header className="border-b p-5 pr-12"><Dialog.Title className="text-lg font-bold">Editar campanha</Dialog.Title><Dialog.Description className="mt-1 text-xs leading-relaxed text-muted-foreground">Revise os dados antes de publicar. Compras já realizadas mantêm seus valores; preços e limites só mudam sem reservas pendentes.</Dialog.Description><Dialog.Close asChild><Button variant="ghost" size="icon" className="absolute right-3 top-3" disabled={pending} aria-label="Fechar edição"><X /></Button></Dialog.Close></header><form className="flex min-h-0 flex-col" onSubmit={event => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    setError(""); start(async () => {
      const result = await editRaffleCampaign(c.id, { ...Object.fromEntries(form), image_url: c.image_url, hide_winning_numbers: form.get("hide_winning_numbers") === "on" }, c);
      if (!result.ok) { setError(result.error); return; }
      toast.success("Campanha atualizada."); setOpen(false); router.refresh();
    });
  }}><div className="grid min-h-0 gap-5 overflow-y-auto p-5"><label className={field}>Título<Input name="title" defaultValue={c.title} minLength={3} maxLength={160} required disabled={pending} /></label><label className={field}>Descrição e regulamento<Textarea name="description" defaultValue={c.description} minLength={10} maxLength={6000} rows={5} required disabled={pending} /></label><div className="grid gap-4 sm:grid-cols-2"><label className={field}>Preço por cota (R$)<Input name="unit_price" type="number" min="0.01" max={10000} step="0.01" defaultValue={c.unit_price} required disabled={pending} /></label><label className={field}>Quantidade total de cotas<Input name="total_numbers" type="number" min={2} max={10000} step={1} defaultValue={c.total_numbers} required disabled={pending} /></label><label className={field}>Mínimo por compra<Input name="min_quantity" type="number" min={1} max={1000} step={1} defaultValue={c.min_quantity} required disabled={pending} /></label><label className={field}>Máximo por compra<Input name="max_quantity" type="number" min={1} max={1000} step={1} defaultValue={c.max_quantity} required disabled={pending} /></label><label className={field}>Escolha dos números<select className={select} name="selection_mode" defaultValue={c.selection_mode} disabled={pending}><option value="both">Manual e automática</option><option value="manual">Somente manual</option><option value="automatic">Somente automática</option></select></label><label className={field}>Método de apuração<select className={select} name="draw_method" defaultValue={c.draw_method} disabled={pending}><option value="external">Sorteador externo</option><option value="federal">Loteria Federal</option></select></label></div><label className={field}>Regras da apuração<Textarea name="draw_rules" defaultValue={c.draw_rules} minLength={10} maxLength={2000} rows={4} required disabled={pending} /></label><label className={field}>Previsão de envio (opcional)<Input name="shipping_date" type="date" defaultValue={c.shipping_date ?? ""} disabled={pending} /><span className="text-xs font-normal text-muted-foreground">Altera a previsão da campanha. Prêmios já conquistados mantêm sua data de envio.</span></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="hide_winning_numbers" defaultChecked={c.hide_winning_numbers} disabled={pending} className="size-4 accent-yellow-500" />Ocultar cotas premiadas até o pagamento</label><p className="rounded-lg border bg-muted p-3 text-xs leading-relaxed text-muted-foreground">Quantidade de cotas, método de apuração e ocultação só podem mudar antes da primeira reserva. Fotos e promoções continuam nas respectivas abas.</p>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}</div><footer className="flex justify-end gap-2 border-t p-4"><Dialog.Close asChild><Button variant="outline" type="button" disabled={pending}>Cancelar</Button></Dialog.Close><Button type="submit" disabled={pending}>{pending ? "Salvando…" : "Salvar alterações"}</Button></footer></form></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
