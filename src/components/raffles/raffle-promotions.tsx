"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Tag } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveRafflePromotions } from "@/app/actions/raffles";
import { type Raffle, raffleMoney } from "@/lib/raffles";
import { type RafflePriceTier, rafflePriceQuote, validateRafflePriceTiers } from "@/lib/raffle-pricing";

export function RafflePromotionFields({ tiers, onChange, disabled=false, base, maximum }: { tiers:RafflePriceTier[];onChange:(rows:RafflePriceTier[])=>void;disabled?:boolean;base:number;maximum:number }) {
  return <div className="grid min-w-0 gap-4"><div><h3 className="flex items-center gap-2 text-sm font-semibold"><Tag size={16}/>Promoção automática por quantidade</h3><p className="mt-2 text-sm text-muted-foreground">A partir da quantidade indicada, todas as cotas da compra recebem o novo preço. Não exige cupom.</p></div>
    {tiers.map((row,i)=><div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-3 rounded-xl border p-3"><label className="grid min-w-0 gap-2 text-xs font-medium">A partir de quantas cotas?<Input aria-label={`Quantidade da faixa ${i+1}`} type="number" min={2} max={maximum} required value={row.min_quantity||""} disabled={disabled} onChange={e=>onChange(tiers.map((t,j)=>j===i?{...t,min_quantity:Number(e.target.value)}:t))}/></label><label className="grid min-w-0 gap-2 text-xs font-medium">Preço por cota (R$)<Input aria-label={`Preço da faixa ${i+1}`} type="number" min="0.01" max={base} step="0.01" required value={row.unit_price||""} disabled={disabled} onChange={e=>onChange(tiers.map((t,j)=>j===i?{...t,unit_price:Number(e.target.value)}:t))}/></label><Button type="button" size="icon" variant="ghost" aria-label={`Remover faixa ${i+1}`} disabled={disabled} onClick={()=>onChange(tiers.filter((_,j)=>j!==i))}><Trash2 size={16}/></Button></div>)}
    <Button className="w-fit" type="button" variant="outline" disabled={disabled||tiers.length>=10||maximum<2} onClick={()=>onChange([...tiers,{min_quantity:0,unit_price:0}])}><Plus size={16}/>Adicionar faixa</Button>
    {tiers.length>0&&<p className="text-xs text-muted-foreground">Até 10 faixas. Cada faixa deve reduzir o preço por cota. A melhor faixa atingida vale para toda a compra.</p>}
  </div>;
}

export function RafflePromotionEditor({campaign:c}:{campaign:Raffle}) {
  const router=useRouter();const [tiers,setTiers]=useState<RafflePriceTier[]>(c.price_tiers??[]);const [pending,start]=useTransition();
  const editable=!c.archived_at&&["draft","paused"].includes(c.status);
  let example:null|ReturnType<typeof rafflePriceQuote>=null;
  try { const valid=validateRafflePriceTiers(tiers,c.unit_price,c.max_quantity);if(valid.length)example=rafflePriceQuote(c.unit_price,valid,valid[0].min_quantity); } catch { /* Campos incompletos são validados ao salvar. */ }
  return <form className="rf-panel grid max-w-3xl gap-5" onSubmit={e=>{e.preventDefault();start(async()=>{const r=await saveRafflePromotions(c.id,tiers,c.price_tiers??[]);if(!r.ok)toast.error(r.error);else{toast.success("Promoções salvas. Reservas existentes mantêm o preço original.");router.refresh();}});}}>
    <RafflePromotionFields tiers={tiers} onChange={setTiers} disabled={pending||!editable} base={c.unit_price} maximum={c.max_quantity}/>
    <p className="text-sm">Preço normal: <strong>{raffleMoney(c.unit_price)} por cota</strong>.</p>
    {example&&<p className="rounded-xl bg-muted p-4 text-sm">Exemplo: {example.tier_min} cotas × {raffleMoney(example.unit_price)} = <strong>{raffleMoney(example.total)}</strong>. Comprando mais, o preço por cota continua reduzido.</p>}
    <p className="text-xs text-muted-foreground">{editable?"Os novos preços valem somente para novas reservas. Pix já gerados não são alterados.":"Pause as vendas para alterar as promoções. Campanhas encerradas ou arquivadas não podem ser alteradas."}</p>
    {editable&&<Button type="submit" className="w-fit" disabled={pending}>{pending?"Salvando…":"Salvar promoções"}</Button>}
  </form>;
}
