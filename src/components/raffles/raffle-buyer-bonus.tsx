"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { manageBuyerBonus } from "@/app/actions/raffle-buyer-bonus";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { raffleMoney } from "@/lib/raffles";

export type BuyerBonus = { title: string; delivery_kind: string; amount: number | null; version: number };
type BonusResult = { title: string; quantity: number; status: string; delivery_kind: string; amount: number | null; winner: string; fulfillment_note: string | null };
type Buyer = { name: string; quantity: number; reached_at: string | null; missing_time: boolean };

export function RaffleBuyerBonusAdmin({ campaign, status, owner, readonly, bonus, result, buyers }: {
  campaign: string; status: string; owner: boolean; readonly: boolean; bonus: BuyerBonus | null; result: BonusResult | null; buyers: Buyer[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState(bonus?.delivery_kind ?? "physical");
  const [alreadyFulfilled, setAlreadyFulfilled] = useState(false);
  const run = (input: unknown) => start(async () => {
    const response = await manageBuyerBonus(input);
    if (!response.ok) { toast.error(response.error); return; }
    toast.success("Bônus atualizado."); router.refresh();
  });
  const editable = !readonly && ["draft", "paused", "open"].includes(status) && !result;
  return <section className="rf-panel grid gap-4">
    <div><h2 className="rf-panel-title">Prêmio do maior comprador</h2><p className="rf-caption mt-2">Maior quantidade de cotas pagas. Em empate, vence quem atingir o total primeiro com pagamentos confirmados. Empate exato exige conferência.</p></div>
    {bonus ? <p className="rounded-xl border border-ouro/40 p-3 text-sm font-semibold">{bonus.title}{bonus.amount ? ` · ${raffleMoney(bonus.amount)}` : ""}</p> : <p className="rf-caption">Esta campanha ainda não tem bônus configurado.</p>}
    {editable && <form className="grid gap-3 sm:grid-cols-2" onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      run({ action: "save", campaign, title: String(form.get("title")), kind, amount: kind === "physical" ? null : Number(form.get("amount")), version: bonus?.version ?? 0 });
    }}>
      <label className="grid gap-1 text-sm">Prêmio<Input name="title" defaultValue={bonus?.title} required minLength={3} maxLength={120} disabled={pending} /></label>
      <label className="grid gap-1 text-sm">Entrega<select className="h-10 rounded-md border bg-background px-3" value={kind} onChange={e => setKind(e.target.value)} disabled={pending}><option value="physical">Produto físico</option><option value="pix">Pix</option><option value="voucher">Voucher</option></select></label>
      {kind !== "physical" && <label className="grid gap-1 text-sm">Valor (R$)<Input name="amount" type="number" min="0.01" max="100000" step="0.01" defaultValue={bonus?.amount ?? ""} required disabled={pending} /></label>}
      <Button type="submit" disabled={pending}>Salvar bônus</Button>
    </form>}
    {editable && <p className="rf-caption">O prêmio pode ser editado mesmo após a publicação e as primeiras reservas, até o encerramento. Alterações ficam no histórico e não modificam pagamentos. A apuração ocorre automaticamente no encerramento.</p>}
    {buyers.length > 0 && <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="mb-2 text-left font-semibold">Ranking de cotas pagas {status !== "closed" && "· Parcial"}</caption><thead><tr><th className="p-2">Cliente</th><th className="p-2">Cotas</th><th className="p-2">Total atingido em</th></tr></thead><tbody>{buyers.map((buyer, index) => <tr key={index} className="border-t"><td className="p-2">{index + 1}. {buyer.name}</td><td className="p-2">{buyer.quantity}</td><td className="p-2">{buyer.missing_time ? "Conferir pagamento sem data" : buyer.reached_at ? new Date(buyer.reached_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—"}</td></tr>)}</tbody></table></div>}
    {result && <div className="grid gap-3 rounded-xl bg-muted p-4"><p className="font-semibold">Ganhador: {result.winner} · {result.quantity} cotas pagas</p><p className="text-sm">{result.status === "review" ? "Em revisão: pagamentos alterados após a apuração. Confira antes de entregar." : result.status === "fulfilled" ? "Entrega/pagamento confirmado" : result.delivery_kind === "physical" ? "Prêmio registrado no painel do cliente e no relatório de separação." : "Aguardando pagamento do Pix ou entrega do voucher pela equipe."}</p>{result.fulfillment_note && <p className="text-sm">{result.fulfillment_note}</p>}
      {!readonly && result.status === "pending" && result.delivery_kind !== "physical" && <form className="grid gap-2" onSubmit={event => { event.preventDefault(); const note = String(new FormData(event.currentTarget).get("note")); if (confirm("Confirmar que o Pix foi pago ou o voucher foi entregue?")) run({ action: "fulfill", campaign, note }); }}><label className="grid gap-1 text-sm">Referência do comprovante ou voucher<Input name="note" required minLength={10} maxLength={500} disabled={pending} /></label><Button disabled={pending}>Confirmar pagamento / entrega</Button></form>}
    </div>}
    {status === "closed" && bonus && !result && <div className="grid gap-3 rounded-xl border border-amber-500/40 p-4"><p className="text-sm">Campanha anterior à automação. Confira se o bônus já foi entregue antes de registrar, evitando uma nova separação ou pagamento em duplicidade.</p>{owner && !readonly && <form className="grid gap-3" onSubmit={event => { event.preventDefault(); const note = String(new FormData(event.currentTarget).get("note")); if (confirm(alreadyFulfilled ? "Registrar entrega anterior, sem gerar novo envio?" : "Registrar como pendente? Produto físico será incluído para separação.")) run({ action: "historical", campaign, alreadyFulfilled, note }); }}><label className="flex gap-2 text-sm"><input type="checkbox" checked={alreadyFulfilled} onChange={e => setAlreadyFulfilled(e.target.checked)} disabled={pending} />Já foi pago ou entregue</label><Input name="note" placeholder="Registre a conferência da entrega anterior" required minLength={10} maxLength={500} disabled={pending} /><Button disabled={pending}>Registrar conferência e apurar</Button></form>}</div>}
  </section>;
}
