"use client";
import { useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { Plus, X, Trash2, ImagePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { addRaffleInstantPrizes, uploadRaffleImage, saveRafflePrizePhotos } from "@/app/actions/raffles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Draft = { id: string; title: string; quantity: number; image_urls: string[] };
const fresh = (): Draft => ({ id: crypto.randomUUID(), title: "", quantity: 1, image_urls: [] });
async function prepare(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 20000000) throw new Error("Use fotos JPG, PNG ou WebP de até 20 MB.");
  const image = await createImageBitmap(file);
  try {
    if (image.width * image.height > 60000000) throw new Error("Esta imagem é muito grande. Reduza a resolução.");
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Não foi possível preparar a foto.");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", 0.8));
    if (!blob || blob.size > 1000000) throw new Error("Reduza o tamanho desta foto e tente novamente.");
    return new File([blob], "premio.webp", { type: "image/webp" });
  } finally { image.close(); }
}
export function InstantPrizeDialog({ campaign, disabled = false }: { campaign: string; disabled?: boolean }) {
  const router = useRouter(); const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Draft[]>([]); const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false); const [error, setError] = useState("");
  const lock = useRef(false); const key = useRef<string | null>(null);
  const update = (id: string, patch: Partial<Draft>) => setItems(current => current.map(item => item.id === id ? { ...item, ...patch } : item));
  async function upload(id: string, files: File[]) {
    if (lock.current || submitted || !files.length) return;
    const row = items.find(item => item.id === id); if (!row) return;
    if (row.image_urls.length + files.length > 4) { toast.error("Até quatro fotos por prêmio."); return; }
    lock.current = true; setBusy(true); setError("");
    try {
      for (const file of files) {
        const form = new FormData(); form.set("file", await prepare(file));
        const result = await uploadRaffleImage(form); if (!result.ok) throw new Error(result.error);
        setItems(current => current.map(item => item.id === id ? { ...item, image_urls: [...item.image_urls, result.data] } : item));
      }
    } catch (error) { setError(error instanceof Error ? error.message : "Não foi possível enviar a foto."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function save() {
    if (lock.current) return;
    const total = items.reduce((sum, item) => sum + item.quantity, 0);
    if (!items.length || items.some(item => !item.title.trim() || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) || total > 100) { setError("Preencha os nomes e quantidades. Limite de 100 prêmios por vez."); return; }
    lock.current = true; setBusy(true); setSubmitted(true); setError(""); key.current ??= crypto.randomUUID();
    try {
      const result = await addRaffleInstantPrizes({ campaign, key: key.current, items: items.map(({ title, quantity, image_urls }) => ({ title, quantity, image_urls })) });
      if (!result.ok) { setError(result.error); return; }
      toast.success("Cotas premiadas adicionadas com sucesso."); setOpen(false); setItems([]); setSubmitted(false); key.current = null; router.refresh();
    } catch { setError("Não foi possível confirmar. Tente novamente: a mesma solicitação será retomada sem duplicar prêmios."); }
    finally { lock.current = false; setBusy(false); }
  }
  const total = items.reduce((sum, item) => sum + (Number.isFinite(item.quantity) ? item.quantity : 0), 0);
  return <Dialog.Root open={open} onOpenChange={value => { if (!lock.current) { if (value && !items.length) setItems([fresh()]); setOpen(value); } }}>
    <Dialog.Trigger asChild><Button disabled={disabled}><Plus size={16} />Adicionar cotas premiadas</Button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" /><Dialog.Content onEscapeKeyDown={e => { if (busy) e.preventDefault(); }} onInteractOutside={e => e.preventDefault()} className="fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border bg-background shadow-xl">
      <header className="flex items-start justify-between gap-3 border-b p-5"><div><Dialog.Title className="text-lg font-bold">Adicionar cotas premiadas</Dialog.Title><Dialog.Description className="mt-1 text-sm text-muted-foreground">Cadastre seus prêmios e fotos. Os números serão atribuídos aleatoriamente às cotas livres.</Dialog.Description></div><Dialog.Close asChild><Button size="icon" variant="ghost" disabled={busy} aria-label="Fechar"><X size={18} /></Button></Dialog.Close></header>
      <div className="grid min-h-0 gap-4 overflow-y-auto p-5">{items.map((item, i) => <section key={item.id} onPaste={event => { const files = Array.from(event.clipboardData.items).filter(x => x.kind === "file" && x.type.startsWith("image/")).map(x => x.getAsFile()).filter((x): x is File => Boolean(x)); if (files.length) { event.preventDefault(); void upload(item.id, files); } }} className="grid gap-4 rounded-xl border p-4">
        <div className="flex items-center justify-between"><h3 className="font-semibold">Prêmio {i + 1}</h3><Button variant="ghost" size="icon" aria-label={`Remover prêmio ${i + 1}`} disabled={busy || submitted || items.length === 1} onClick={() => setItems(current => current.filter(x => x.id !== item.id))}><Trash2 size={16} /></Button></div>
        <div className="grid gap-3 sm:grid-cols-[1fr_100px]"><label className="grid gap-2 text-sm">Nome<Input value={item.title} maxLength={160} disabled={busy || submitted} onChange={e => update(item.id, { title: e.target.value })} placeholder="Ex.: Figurinha Yamal Ouro" /></label><label className="grid gap-2 text-sm">Quantidade<Input type="number" min={1} max={100} value={item.quantity || ""} disabled={busy || submitted} onChange={e => update(item.id, { quantity: Number(e.target.value) })} /></label></div>
        <div className="flex flex-wrap gap-2">{item.image_urls.map((url, photo) => <div key={url} className="relative size-20 rounded-lg border"><picture><img src={url} alt={`Foto ${photo + 1} de ${item.title || "prêmio"}`} className="size-full rounded-lg object-contain" /></picture><button type="button" aria-label={`Remover foto ${photo + 1}`} disabled={busy || submitted} onClick={() => update(item.id, { image_urls: item.image_urls.filter(x => x !== url) })} className="absolute -right-1 -top-1 rounded-full border bg-background p-1"><X size={12} /></button></div>)}</div>
        <label tabIndex={0} className="grid gap-2 rounded-xl border border-dashed p-3 text-sm focus-visible:outline-2"><span className="flex items-center gap-2"><ImagePlus size={16} />Anexar ou colar fotos com Ctrl+V</span><span className="text-xs text-muted-foreground">Clique neste espaço e cole a imagem copiada. Até 4 fotos por prêmio; se houver várias unidades, elas usam as mesmas fotos.</span><Input type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={busy || submitted || item.image_urls.length >= 4} onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ""; void upload(item.id, files); }} /></label>
      </section>)}<Button variant="outline" disabled={busy || submitted || items.length >= 100 || total >= 100} onClick={() => setItems(current => [...current, fresh()])}><Plus size={16} />Adicionar outro prêmio</Button>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}{submitted && error && <p className="text-xs text-muted-foreground">Os dados foram mantidos para repetir com segurança a mesma solicitação.</p>}</div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t p-5"><span className="text-sm text-muted-foreground">{total} cota(s) premiada(s)</span><Button onClick={() => void save()} disabled={busy}>{busy ? "Aguarde…" : submitted ? "Tentar novamente" : "Salvar cotas premiadas"}</Button></footer>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}

export function PrizePhotoDialog({ prize }: { prize: { id: string; title: string; image_urls?: string[] } }) {
 const [open,setOpen]=useState(false), [urls,setUrls]=useState(prize.image_urls??[]), [busy,setBusy]=useState(false), [error,setError]=useState("");
 const lock=useRef(false);const router=useRouter();
 async function add(files:File[]){
  if(lock.current||!files.length)return;
  if(urls.length+files.length>4){setError("Até quatro fotos por prêmio.");return;}
  lock.current=true;setBusy(true);setError("");
  try{for(const file of files){const form=new FormData();form.set("file",await prepare(file));const result=await uploadRaffleImage(form);if(!result.ok)throw Error(result.error);setUrls(current=>[...current,result.data]);}}
  catch(e){setError(e instanceof Error?e.message:"Falha ao enviar foto.");}finally{lock.current=false;setBusy(false);}
 }
 return <Dialog.Root open={open} onOpenChange={v=>{if(!lock.current)setOpen(v);}}><Dialog.Trigger asChild><Button size="sm" variant="outline"><ImagePlus size={14}/>Fotos</Button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/60"/><Dialog.Content className="fixed left-1/2 top-1/2 z-50 grid max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-2xl border bg-background p-5" onInteractOutside={e=>e.preventDefault()}><Dialog.Title className="font-bold">Fotos de {prize.title}</Dialog.Title><Dialog.Description className="text-sm text-muted-foreground">Até quatro fotos. Anexe ou clique no espaço abaixo e cole com Ctrl+V.</Dialog.Description><div tabIndex={0} className="grid gap-3 rounded-xl border border-dashed p-3" onPaste={e=>{const files=Array.from(e.clipboardData.items).map(x=>x.getAsFile()).filter((x):x is File=>Boolean(x&&x.type.startsWith("image/")));if(files.length){e.preventDefault();void add(files);}}}><div className="flex flex-wrap gap-3">{urls.map((url,i)=><div key={url} className="grid w-24 gap-1"><picture><img src={url} alt={`Foto ${i+1}`} className="size-24 object-contain"/></picture><Button size="sm" variant="outline" disabled={busy} onClick={()=>setUrls(current=>current.filter(x=>x!==url))}>Remover</Button></div>)}</div><Input type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={busy||urls.length>=4} onChange={e=>{const files=Array.from(e.target.files??[]);e.target.value="";void add(files);}}/></div>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}<div className="flex justify-end gap-2"><Dialog.Close asChild><Button variant="outline" disabled={busy}>Fechar</Button></Dialog.Close><Button disabled={busy} onClick={async()=>{if(lock.current)return;lock.current=true;setBusy(true);setError("");try{const r=await saveRafflePrizePhotos(prize.id,urls);if(!r.ok)setError(r.error);else{toast.success("Fotos salvas.");setOpen(false);router.refresh();}}catch{setError("Não foi possível salvar. Tente novamente.");}finally{lock.current=false;setBusy(false);}}}>{busy?"Aguarde…":"Salvar fotos"}</Button></div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
