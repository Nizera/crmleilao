"use client";
import {useTransition,useState} from "react";
import {useRouter} from "next/navigation";
import {saveVoucherTemplate} from "@/app/actions/store-vouchers";
import type {VoucherTemplate,CustomerVoucher} from "@/lib/store-vouchers";
import {storeBRL,coinNumber} from "@/lib/store";
import {VoucherArtwork} from "@/components/shared/voucher-artwork";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
function VoucherEditor({voucher,products,canEdit}:{voucher?:VoucherTemplate;products:{id:string;name:string}[];canEdit:boolean}){
 const [pending,start]=useTransition();const [message,setMessage]=useState('');const [discount,setDiscount]=useState(String(voucher?.discount_cash??''));const router=useRouter();
 return <form action={form=>start(async()=>{const r=await saveVoucherTemplate(form);setMessage(r.ok?'Voucher salvo.':r.error);if(r.ok)router.refresh();})} className="grid gap-4 rounded-xl border bg-card p-4 sm:p-5">
  <div className="max-w-sm"><VoucherArtwork amount={Number(discount)}/></div><h3 className="font-semibold">{voucher?'Editar voucher':'Novo voucher'}</h3>{voucher&&<><input type="hidden" name="id" value={voucher.id}/><input type="hidden" name="updated_at" value={voucher.updated_at}/></>}
  <fieldset disabled={!canEdit||pending} className="grid min-w-0 gap-3 sm:grid-cols-2">
   <label className="grid gap-1 text-sm sm:col-span-2">Nome<Input name="name" minLength={2} maxLength={120} required defaultValue={voucher?.name}/></label>
   <label className="grid gap-1 text-sm">Custo em Caracoins<Input name="coins_cost" type="number" min="0.01" max={9999999} step="0.01" defaultValue={voucher?.coins_cost??''} placeholder="A definir"/></label>
   <label className="grid gap-1 text-sm">Desconto em reais<Input name="discount_cash" type="number" min="0.01" max={9999999} step="0.01" value={discount} onChange={event=>setDiscount(event.target.value)} placeholder="A definir"/></label>
   <label className="grid gap-1 text-sm">Compra mínima elegível (R$)<Input name="min_purchase" type="number" min={0} max={9999999} step="0.01" defaultValue={voucher?.min_purchase??0}/></label>
   <label className="grid gap-1 text-sm">Validade após resgate (dias)<Input name="validity_days" type="number" min={1} max={365} defaultValue={voucher?.validity_days??30} required/></label>
   <label className="grid gap-1 text-sm">Limite total de resgates<Input name="max_redemptions" type="number" min={1} max={9999999} defaultValue={voucher?.max_redemptions??''} placeholder="Sem limite"/></label>
   <label className="grid gap-1 text-sm">Limite por cliente<Input name="max_per_customer" type="number" min={1} max={10000} defaultValue={voucher?.max_per_customer??1} required/></label>
   <fieldset className="grid gap-2 rounded-lg border p-3 sm:col-span-2"><legend className="px-1 text-sm">Produtos elegíveis</legend><p className="text-xs text-muted-foreground">Nenhum selecionado: todos os produtos em reais. O mínimo considera apenas os itens elegíveis. O desconto nunca ultrapassa esse subtotal e não abate frete.</p><div className="grid max-h-48 gap-2 overflow-y-auto">{voucher?.eligible_product_ids.filter(id=>!products.some(p=>p.id===id)).map(id=><label key={id} className="flex gap-2 text-sm"><input name="eligible_product_ids" value={id} type="checkbox" defaultChecked/>Produto fora da lista atual · {id.slice(0,8)}</label>)}{products.map(p=><label key={p.id} className="flex gap-2 text-sm"><input name="eligible_product_ids" value={p.id} type="checkbox" defaultChecked={voucher?.eligible_product_ids.includes(p.id)}/>{p.name}</label>)}</div></fieldset>
   <label className="flex items-center gap-2 text-sm sm:col-span-2"><input name="active" type="checkbox" defaultChecked={voucher?.active}/>Disponível para resgate</label>
  </fieldset>
  <p className="text-xs text-muted-foreground">Pode salvar como rascunho sem custo e desconto. Alterações só afetam novos resgates; vouchers já emitidos mantêm as regras originais.</p>
  {message&&<p role="status" className="text-sm">{message}</p>}{canEdit&&<Button disabled={pending}>{pending?'Salvando…':'Salvar voucher'}</Button>}
 </form>;
}
export function AdminVouchers({templates,issued,products,canEdit}:{templates:VoucherTemplate[];issued:(CustomerVoucher&{customer?:{name:string|null}|null})[];products:{id:string;name:string}[];canEdit:boolean}){
 return <div className="grid gap-6"><p className="rounded-xl border bg-muted/30 p-4 text-sm">Produtos têm uma moeda. O cliente troca Caracoins por um voucher, depois aplica esse desconto a uma compra em reais. Um voucher por pedido. A loja continua em prévia até a liberação explícita.</p><VoucherEditor products={products} canEdit={canEdit}/><section className="grid gap-3"><h2 className="text-lg font-semibold">Vouchers cadastrados</h2>{templates.map(v=><details key={v.id} className="rounded-xl border p-3"><summary className="cursor-pointer font-medium">{v.name} · {v.active?'Ativo':'Rascunho'} · {v.discount_cash===null?'Desconto a definir':storeBRL(Number(v.discount_cash))}</summary><div className="mt-3"><VoucherEditor key={v.updated_at} voucher={v} products={products} canEdit={canEdit}/></div></details>)}{!templates.length&&<p className="text-sm text-muted-foreground">Nenhum voucher cadastrado.</p>}</section><section className="grid gap-3"><h2 className="text-lg font-semibold">Resgates e utilização</h2>{issued.map(v=><article key={v.id} className="rounded-xl border p-4 text-sm"><strong>{v.name}</strong><p>{v.customer?.name??'Cliente'} · {coinNumber(Number(v.coins_paid))} Caracoins · {storeBRL(Number(v.discount_cash))} de desconto</p><p className="mt-1 text-xs text-muted-foreground">{v.status==='used'?'Utilizado':v.status==='reserved'?'Reservado no pedido':'Disponível conforme validade'} · válido até {new Date(v.expires_at).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'})}{v.order_id?` · pedido ${v.order_id.slice(0,8)}`:''}</p></article>)}{!issued.length&&<p className="text-sm text-muted-foreground">Nenhum resgate nesta página.</p>}</section></div>;
}
