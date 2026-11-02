"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trophy, Gift, Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { createRaffle, manageRaffle, setRafflePurchases, reconcileRaffles, uploadRaffleImage, resolveRaffleReview, raffleCampaignLifecycle } from "@/app/actions/raffles";
import { quotaLabel, raffleMoney, raffleStatus, type Raffle } from "@/lib/raffles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RaffleWinnerForm } from "@/components/raffles/raffle-winner-form";
import { RafflePhotoEditor } from "@/components/raffles/raffle-photo-editor";

const field = "grid min-w-0 gap-2 text-sm font-medium";
const select = "h-10 min-w-0 rounded-md border bg-background px-3 text-sm";
export function RaffleLifecycleButtons({campaign,owner=false}:{campaign:Raffle;owner?:boolean}){
 const router=useRouter();const [pending,start]=useTransition();
 const run=(action:"archive"|"restore"|"delete")=>{
  const message=action==="delete"?"Excluir definitivamente este rascunho? Esta ação não pode ser desfeita. Campanhas com reservas não podem ser excluídas.":action==="archive"?"Arquivar esta campanha e interromper novas vendas? Reservas, pagamentos e prêmios continuam salvos.":"Restaurar esta campanha? As vendas não serão reabertas automaticamente.";
  if(!confirm(message))return;
  start(async()=>{const r=await raffleCampaignLifecycle(campaign.id,action);if(!r.ok)toast.error(r.error);else{toast.success(action==="delete"?"Rascunho excluído.":action==="archive"?"Campanha arquivada.":"Campanha restaurada.");router.push(`/admin/rifa?status=${action==="archive"?"archived":action==="delete"?"draft":campaign.status}`);router.refresh();}});
 };
 return <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={pending} onClick={()=>run(campaign.archived_at?"restore":"archive")}>{campaign.archived_at?"Restaurar":"Arquivar"}</Button>{owner&&campaign.status==="draft"&&<Button size="sm" variant="destructive" disabled={pending} onClick={()=>run("delete")}>Excluir rascunho</Button>}</div>;
}
export function RaffleReviewButton({ id }: { id: string }) {
  const router = useRouter(); const [pending, start] = useTransition();
  return <div className="grid gap-2"><p className="max-w-sm text-xs text-muted-foreground">Confira o estorno integral no Mercado Pago. Prêmios já revelados ficam retidos; as demais cotas podem voltar à venda. Esta ação não faz reembolso.</p><Button variant="outline" disabled={pending} onClick={() => { if (!confirm("Consultar o Mercado Pago e encerrar esta reserva somente se o estorno integral estiver confirmado?")) return; start(async () => { const result = await resolveRaffleReview(id); if (!result.ok) toast.error(result.error); else { toast.success("Estorno conferido e reserva encerrada."); router.refresh(); } }); }}>{pending ? "Conferindo…" : "Conferir estorno integral"}</Button></div>;
}
export function RaffleSettings({ enabled, owner }: { enabled: boolean; owner: boolean }) {
  const router = useRouter(); const [pending, start] = useTransition();
  return <section className="grid gap-4 rounded-xl border p-5"><h2 className="font-bold">Compras de cotas {enabled ? "liberadas" : "bloqueadas"}</h2><p className="text-sm text-muted-foreground">Campanhas publicadas podem ser consultadas. Esta chave controla novas reservas em todas as campanhas, inclusive chamadas diretas ao banco. Pagamentos já iniciados continuam sendo acompanhados.</p>{owner && <Button disabled={pending} onClick={() => { if (!confirm(enabled ? "Bloquear novas compras de cotas?" : "Liberar compras em todas as campanhas publicadas? Esta configuração vale para o banco compartilhado, inclusive produção.")) return; start(async () => { const r = await setRafflePurchases(!enabled); if (!r.ok) toast.error(r.error); else { toast.success("Configuração atualizada."); router.refresh(); } }); }}>{pending ? "Salvando…" : enabled ? "Bloquear novas compras" : "Liberar novas compras"}</Button>}<p className="text-xs text-muted-foreground">Não é necessário configurar outra chave do Mercado Pago. É usado o webhook assinado já existente. As reservas duram 10 minutos. Ao vencer, o servidor cancela o Pix e libera as cotas após confirmação do Mercado Pago.</p></section>;
}
export function RaffleReconcileButton() {
  const router = useRouter(); const [pending, start] = useTransition();
  return <Button variant="outline" disabled={pending} onClick={() => start(async () => { const r = await reconcileRaffles(); if (!r.ok) toast.error(r.error); else { toast.success(`${r.data.checked} pagamento(s) consultados. ${r.data.failed} sem confirmação.`); router.refresh(); } })}>{pending ? "Conferindo…" : "Conferir pagamentos pendentes"}</Button>;
}
export function RaffleCreateForm() {
  const router = useRouter(); const [pending, start] = useTransition(); const [image, setImage] = useState("");
  return <form className="grid gap-6 rounded-2xl border bg-card p-4 sm:p-6" onSubmit={e => {
    e.preventDefault(); const form = new FormData(e.currentTarget);
    start(async () => {
      const result = await createRaffle({ ...Object.fromEntries(form), hide_winning_numbers: form.get("hide_winning_numbers") === "on" });
      if (!result.ok) { toast.error(result.error); return; }
      router.push(`/admin/rifa/${result.data}`); router.refresh();
    });
  }}>
    <div><h2 className="text-lg font-bold">Nova campanha</h2><p className="mt-1 text-sm text-muted-foreground">Salve o rascunho, cadastre os prêmios e confira antes de publicar.</p></div>
    <label className={field}>Nome da campanha<Input name="title" required minLength={3} maxLength={160} placeholder="Quadro Messi com Legends originais" /></label>
    <label className={field}>Descrição e regulamento<Textarea name="description" required minLength={10} maxLength={6000} rows={5} placeholder="Explique o prêmio, a participação e a entrega." /></label>
    <div className="grid gap-4 sm:grid-cols-2"><label className={field}>Quantidade de cotas<Input name="total_numbers" type="number" min={2} max={10000} defaultValue={100} required /><span className="text-xs font-normal text-muted-foreground">De 000 em diante. Até 10.000 cotas nesta versão.</span></label><label className={field}>Preço por cota (R$)<Input name="unit_price" type="number" min="0.01" max={10000} step="0.01" required /></label>
    <label className={field}>Escolha dos números<select name="selection_mode" className={select} defaultValue="both"><option value="both">Manual e automática</option><option value="manual">Somente manual</option><option value="automatic">Somente automática</option></select></label>
    <label className={field}>Apuração<select name="draw_method" className={select}><option value="external">Sorteador externo</option><option value="federal">Loteria Federal</option></select></label>
    <label className={field}>Mínimo de cotas por compra<Input name="min_quantity" type="number" min={1} max={1000} defaultValue={1} required /></label><label className={field}>Máximo de cotas por compra<Input name="max_quantity" type="number" min={1} max={1000} defaultValue={100} required /></label>
    <label className={field}>Previsão de envio dos prêmios (opcional)<Input name="shipping_date" type="date" /><span className="text-xs font-normal text-muted-foreground">Pode deixar em branco. O prêmio entra na fila de separação quando for conquistado.</span></label><label className={field}>Imagem de capa<Input type="file" accept="image/png,image/jpeg,image/webp" disabled={pending} onChange={e => { const file = e.target.files?.[0]; if (!file) return; const form = new FormData(); form.set("file", file); start(async () => { const r = await uploadRaffleImage(form); if (!r.ok) toast.error(r.error); else setImage(r.data); }); }} /><input type="hidden" name="image_url" value={image} /><span className="text-xs font-normal text-muted-foreground">{image ? "Imagem enviada. Será usada ao salvar o rascunho." : "JPG, PNG ou WebP de até 1 MB."}</span></label></div>
    <label className={field}>Como o resultado define a cota vencedora<Textarea name="draw_rules" minLength={10} maxLength={2000} rows={3} required placeholder="Informe o site ou concurso e a regra para números não vendidos ou fora do intervalo." /><span className="text-xs font-normal text-muted-foreground">A regra é exibida antes da compra. Preço, numeração e regras ficam fixos neste rascunho.</span></label>
    <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="hide_winning_numbers" defaultChecked className="mt-1" />Ocultar os números das cotas premiadas até a confirmação do pagamento.</label>
    <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">As cotas ficam reservadas por 10 minutos. Depois, o servidor solicita o cancelamento do Pix e aguarda a confirmação para liberar os números.</p>
    <div className="flex flex-wrap gap-3"><Button type="submit" disabled={pending}><Plus />{pending ? "Salvando…" : "Criar rascunho"}</Button><Button asChild variant="outline"><Link href="/admin/rifa">Voltar</Link></Button></div>
  </form>;
}

type Prize = { id: string; title: string; kind: string; number: number | null };
export function RaffleAdminControls({ campaign: c, prizes, awarded }: { campaign: Raffle; prizes: Prize[]; awarded: string[] }) {
  const router = useRouter(); const [pending, start] = useTransition(); const [tab, setTab] = useState("summary");
  const execute = (data: Parameters<typeof manageRaffle>[0]) => start(async () => { const r = await manageRaffle(data); if (!r.ok) toast.error(r.error); else { toast.success("Campanha atualizada."); router.refresh(); } });
  return <div className="grid min-w-0 gap-5">
    <nav aria-label="Gestão da campanha" className="flex gap-2 overflow-x-auto border-b pb-3">{[["summary", "Resumo"], ["prizes", "Prêmios"], ["instant", "Cotas premiadas"], ["result", "Apuração"], ["photos", "Fotos"]].map(([id, label]) => <Button key={id} variant={tab === id ? "default" : "outline"} onClick={() => setTab(id)}>{label}</Button>)}</nav>
    {tab === "summary" && <section className="grid gap-4 rounded-xl border p-5"><p className="font-semibold">{raffleStatus[c.status]} · {c.total_numbers} cotas · {raffleMoney(c.unit_price)} por cota</p><p className="whitespace-pre-wrap text-sm">{c.description}</p><div className="rounded-lg bg-muted p-4 text-sm"><strong>{c.draw_method === "federal" ? "Loteria Federal" : "Sorteador externo"}</strong><p className="mt-2 whitespace-pre-wrap">{c.draw_rules}</p></div><p className="text-xs text-muted-foreground">Regras e preço fixos por campanha. Para mudar a oferta, crie um novo rascunho. Os relatórios financeiros de rifas são separados dos arremates.</p><div className="flex flex-wrap gap-2">{!c.archived_at && ["draft", "paused"].includes(c.status) && !prizes.some(p => p.kind === "main" && awarded.includes(p.id)) && <Button disabled={pending} onClick={() => execute({ campaign: c.id, action: "open" })}><Play />Publicar campanha</Button>}{c.status === "open" && <Button disabled={pending} variant="outline" onClick={() => execute({ campaign: c.id, action: "pause" })}><Pause />Pausar vendas</Button>}{c.status === "paused" && <Button disabled={pending} variant="outline" onClick={() => { if (confirm("Encerrar a campanha após registrar todos os vencedores?")) execute({ campaign: c.id, action: "close" }); }}>Encerrar campanha</Button>}<Button variant="outline" asChild><Link href={`/admin/rifa/reservas?campaign=${c.id}`}>Ver reservas</Link></Button></div></section>}
    {(tab === "prizes" || tab === "instant") && <><section className="grid gap-3 rounded-xl border p-5"><h2 className="flex items-center gap-2 font-bold">{tab === "prizes" ? <Trophy className="size-5" /> : <Gift className="size-5" />}{tab === "prizes" ? "Prêmios do sorteio principal" : "Cotas premiadas"}</h2>{prizes.filter(p => p.kind === (tab === "prizes" ? "main" : "instant")).map(p => <div key={p.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-muted p-3 text-sm"><span>{p.title}</span><strong>{p.number !== null ? `Cota ${quotaLabel(p.number, c.total_numbers)}` : "Prêmio principal"}{awarded.includes(p.id) ? " · Ganhador confirmado" : ""}</strong></div>)}<p className="text-xs text-muted-foreground">{c.hide_winning_numbers ? "Números premiados ocultos para o cliente." : "Números premiados visíveis na campanha."} Novos prêmios aleatórios usam apenas cotas livres e nunca alteram os já existentes.</p></section>
    {["draft", "paused"].includes(c.status) && <form className="grid gap-4 rounded-xl border p-5 sm:grid-cols-[1fr_120px_auto]" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); execute({ campaign: c.id, action: tab === "prizes" ? "main" : "instant", title: String(f.get("title")), quantity: Number(f.get("quantity")) }); }}><label className={field}>Nome do prêmio<Input name="title" required maxLength={160} /></label><label className={field}>Quantidade<Input name="quantity" type="number" min={1} max={100} defaultValue={1} required /></label><Button className="self-end" disabled={pending}><Plus />Adicionar</Button></form>}</>}
    {tab === "photos" && <RafflePhotoEditor key={c.id} campaign={c} />}
    {tab === "result" && <section className="grid gap-4 rounded-xl border p-5"><h2 className="font-bold">Registrar resultado externo</h2><p className="text-sm text-muted-foreground">Pause a campanha e resolva reservas abertas. Informe a cota vencedora do sorteio externo, os detalhes da apuração. Ao confirmar, o prêmio principal fica vinculado ao dono da cota paga, aparece em Meus prêmios com as fotos da campanha e entra na separação para envio.</p>{prizes.filter(p => p.kind === "main").map(p => <RaffleWinnerForm key={p.id} campaign={c} prize={p} awarded={awarded.includes(p.id)} />)}</section>}
  </div>;
}

