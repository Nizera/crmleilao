"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { manageRaffleReservation } from "@/app/actions/raffles";
import { Button } from "@/components/ui/button";
import { Dialog } from "radix-ui";
import { Textarea } from "@/components/ui/textarea";

export function ReservationActions({ id, code }: { id: string; code: string }) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<"paid_external" | "cancel" | "refund_confirmed">("cancel");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return <><Button variant="outline" size="sm" className="mt-2" onClick={() => setOpen(true)}>Gerenciar reserva</Button><Dialog.Root open={open} onOpenChange={value => { if (!pending) setOpen(value); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/60"/><Dialog.Content className="fixed left-1/2 top-1/2 z-50 grid max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-2xl border bg-background p-5"><div><Dialog.Title className="font-bold">Gerenciar reserva</Dialog.Title><Dialog.Description className="mt-2 text-sm text-muted-foreground">{code} · Toda alteração fica registrada no histórico.</Dialog.Description></div><label className="grid gap-2 text-sm">Ação<select className="h-11 rounded-md border bg-background px-3" value={action} disabled={pending} onChange={e => { setAction(e.target.value as typeof action); setConfirmed(false); }}><option value="cancel">Cancelar reserva e liberar cotas</option><option value="paid_external">Confirmar pagamento recebido por fora</option><option value="refund_confirmed">Liberar após estorno conferido pela equipe</option></select></label><p className="text-sm text-muted-foreground">{action === "refund_confirmed" ? "Use somente com comprovante de estorno integral conferido. Esta ação não executa reembolso. Um pagamento recebido depois exigirá análise." : action === "paid_external" ? "Confirme que o valor integral já foi recebido. O Pix anterior precisa ser encerrado antes; as cotas e os prêmios serão vinculados ao comprador." : "O sistema confere e encerra o Pix antes de liberar as cotas. Uma reserva paga não será cancelada por esta opção."}</p><label className="grid gap-2 text-sm">Motivo ou referência do comprovante<Textarea value={reason} onChange={e => setReason(e.target.value)} minLength={10} maxLength={500} disabled={pending} /></label><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={pending} className="mt-1" />Conferi a reserva e o pagamento e confirmo esta alteração.</label><Button disabled={pending || !confirmed || reason.trim().length < 10} onClick={() => start(async () => { const result = await manageRaffleReservation(id, action, reason, confirmed); if (!result.ok) return void toast.error(result.error); toast.success("Reserva atualizada."); setOpen(false); setReason(""); setConfirmed(false); router.refresh(); })}>{pending ? "Conferindo…" : "Confirmar alteração"}</Button><Dialog.Close asChild><Button variant="outline" disabled={pending}>Voltar</Button></Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root></>;
}
