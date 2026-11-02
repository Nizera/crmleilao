'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { saveStoreBanner } from '@/app/actions/store-banner';
import { StoreHero } from '@/components/client/store-hero';
import type { StoreBanner } from '@/lib/store-presentation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function StoreBannerForm({ banner, canEdit }: { banner: StoreBanner; canEdit: boolean }) {
  const [values, setValues] = useState(banner);
  const [previews,setPreviews]=useState<{desktop?:string;mobile?:string}>({});const urls=useRef<string[]>([]);
  useEffect(()=>()=>{urls.current.forEach(url=>URL.revokeObjectURL(url));},[]);
  const [pending, start] = useTransition(); const router = useRouter();
  const field = (key: 'title'|'subtitle'|'button_label'|'button_href', label: string, max: number) => <label className="grid gap-2 text-sm"><span>{label}</span><Input name={key} value={values[key]} maxLength={max} onChange={e => setValues(v => ({ ...v, [key]: e.target.value }))}/></label>;
  return <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"><form action={form => start(async () => { try { const result = await saveStoreBanner(form); if (!result.ok) { toast.error(result.error); return; } toast.success('Banner salvo.'); router.refresh(); } catch { toast.error('Falha de conexão. Confira antes de tentar novamente.'); } })} className="rounded-2xl border bg-card p-5"><fieldset disabled={!canEdit || pending} className="grid gap-5"><input type="hidden" name="updated_at" value={banner.updated_at}/>{field('title','Título',100)}{field('subtitle','Texto de apoio',220)}<div className="grid gap-4 sm:grid-cols-2">{field('button_label','Texto do botão',32)}{field('button_href','Destino do botão',500)}</div><p className="text-xs text-muted-foreground">Use #catalogo-loja ou um link iniciado em /painel/loja. O texto é exibido sobre a imagem; prefira artes sem frases e com espaço livre à esquerda.</p>
    {(['desktop','mobile'] as const).map(slot => <div key={slot} className="grid gap-2 rounded-xl border p-4"><label className="grid gap-2 text-sm"><span>Imagem {slot === 'desktop' ? 'computador · sugestão 1600 × 500 px' : 'celular · sugestão 900 × 700 px'}</span><input type="file" name={slot} accept="image/png,image/jpeg,image/webp" onChange={event=>{const file=event.target.files?.[0];if(!file){setPreviews(v=>({...v,[slot]:undefined}));return;}if(file.size>600000||!['image/png','image/jpeg','image/webp'].includes(file.type)){toast.error('Use JPG, PNG ou WebP de até 600 KB.');event.target.value='';setPreviews(v=>({...v,[slot]:undefined}));return;}const url=URL.createObjectURL(file);urls.current.push(url);setPreviews(v=>({...v,[slot]:url}));}} className="w-full min-w-0 text-xs"/></label><p className="text-xs text-muted-foreground">JPG, PNG ou WebP, até 600 KB. Sem imagem, usamos o fundo da loja.</p>{banner[`${slot}_path`] && <label className="flex gap-2 text-xs"><input type="checkbox" name={`remove_${slot}`}/>Remover imagem atual</label>}</div>)}
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" checked={values.active} onChange={e=>setValues(v=>({...v,active:e.target.checked}))}/>Exibir banner na loja</label><Button type="submit">{pending?'Salvando…':'Salvar banner'}</Button></fieldset></form><aside className="grid content-start gap-3"><h2 className="font-semibold">Prévia do banner</h2><StoreHero banner={{...values,active:true}} previewImages={previews}/><p className="text-xs text-muted-foreground">As alterações só vão para a loja ao salvar. A versão celular é usada em telas menores; sem ela, a imagem de computador é adaptada.</p></aside></div>;
}
