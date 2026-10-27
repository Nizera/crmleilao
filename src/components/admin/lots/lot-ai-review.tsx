"use client";
import { useState,useTransition } from 'react';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { analyzeLotPhotos,type LotAiSuggestion } from '@/app/actions/lot-ai';
import { Button } from '@/components/ui/button';
import { StockPicker } from './stock-picker';
import type { LotItemPick,Player,StockItem } from '@/lib/stock';
export function LotAiReview({files,savedPaths,lotId,players,stock,onApprove,hasItems,disabled}:{files:File[];savedPaths:string[];lotId?:string;players:Player[];stock:StockItem[];onApprove:(items:LotItemPick[])=>void;hasItems:boolean;disabled:boolean}){
 const [pending,startTransition]=useTransition();const [result,setResult]=useState<{key:string;items:LotAiSuggestion[]}|null>(null);const [draft,setDraft]=useState<LotItemPick[]>([]);const [error,setError]=useState('');
 const photos=files.slice(0,3);const saved=savedPaths.slice(0,3-photos.length);const key=photos.map(f=>`${f.name}:${f.size}:${f.lastModified}`).join('|')+saved.join('|');
 const analyze=()=>{setError('');const form=new FormData();photos.forEach(f=>form.append('photos',f));form.set('saved_paths',JSON.stringify(saved));if(lotId)form.set('lot_id',lotId);
 startTransition(async()=>{try{const r=await analyzeLotPhotos(form);if(!r.ok){setError(r.error);return;}setResult({key,items:r.data.items});const picks=new Map<string,number>();for(const row of r.data.items){if(row.stock_item_id&&stock.some(s=>s.id===row.stock_item_id))picks.set(row.stock_item_id,Math.min(999,(picks.get(row.stock_item_id)??0)+row.qty));}setDraft([...picks].map(([stock_item_id,qty])=>({stock_item_id,qty})));}catch{setError('Não foi possível analisar as fotos.');}});};
 const stale=!!result&&result.key!==key;
 return <section className="grid gap-3 rounded-xl border border-ouro/30 bg-amarelo/5 p-4"><div><h3 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 text-ouro-ink"/>Preencher itens com Gemini</h3><p className="mt-1 text-xs text-muted-foreground">Ao clicar, até 3 fotos serão enviadas ao Gemini (Google) com o catálogo de jogadores e cores. Confira a sugestão antes de aplicá-la. A análise não salva o lote nem baixa estoque.</p></div><Button type="button" variant="outline" className="w-fit" disabled={disabled||pending||photos.length+saved.length===0} onClick={analyze}>{pending?'Analisando fotos…':'Analisar com IA'}</Button>
 {pending&&<p role="status" className="text-xs text-muted-foreground">A análise pode levar até 40 segundos. Se o Google estiver ocupado, tentaremos novamente automaticamente até duas vezes.</p>}
 {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
 {result&&<div className="grid gap-3 rounded-lg border bg-background p-3"><h4 className="text-sm font-semibold">Revisar sugestão da IA</h4>{result.items.length===0&&<p className="text-xs text-muted-foreground">Nenhuma figurinha identificada. Tente uma foto mais próxima ou preencha manualmente.</p>}
 <ul className="grid gap-1 text-xs text-muted-foreground">{result.items.map((r,i)=><li key={i}>{r.qty}× {r.label} · {r.stock_item_id?'conferir jogador e cor':'não identificado no catálogo'} · confiança {r.confidence==='high'?'alta':r.confidence==='medium'?'média':'baixa'}</li>)}</ul>
 <p className="text-xs text-muted-foreground">Você pode alterar jogadores, cores e quantidades abaixo. Itens não identificados precisam de preenchimento manual.</p><StockPicker players={players} stock={stock} items={draft} onChange={setDraft} disabled={pending||disabled||stale}/>
 {stale&&<p className="text-sm text-amber-600">As fotos mudaram. Analise novamente antes de aprovar.</p>}
 <Button type="button" disabled={pending||disabled||stale||draft.length===0} onClick={()=>{if(hasItems&&!window.confirm('Substituir a composição atual pelos itens revisados da IA?'))return;onApprove(draft);setResult(null);toast.success('Itens aplicados. Confira e salve o lote quando estiver pronto.');}}>Aprovar e aplicar itens</Button></div>}
 </section>;
}
