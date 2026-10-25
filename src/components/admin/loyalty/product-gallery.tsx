"use client";

import Image from "next/image";
import { useCallback,useEffect,useRef } from "react";
import { ImagePlus,Star,Trash2 } from "lucide-react";
import { toast } from "sonner";
import { MAX_PRODUCT_PHOTOS,MAX_PRODUCT_PHOTO_BYTES } from "@/lib/store-admin";
import { Button } from "@/components/ui/button";

export type GalleryPhoto={key:string;url:string;path?:string;file?:File};
async function optimizeProductPhoto(file:File) {
  if(!["image/jpeg","image/png","image/webp","image/avif"].includes(file.type) || file.size>20000000) throw new Error("Use fotos JPG, PNG, WebP ou AVIF de até 20 MB.");
  const bitmap=await createImageBitmap(file);
  try {
    if(bitmap.width*bitmap.height>40000000)throw new Error("A foto tem resolução muito alta. Envie uma versão menor.");
    for(const [edge,quality] of [[1600,.84],[1400,.72],[1000,.6]]) {
      const scale=Math.min(1,edge/Math.max(bitmap.width,bitmap.height)); const canvas=document.createElement("canvas");
      canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      const ctx=canvas.getContext("2d");if(!ctx)throw new Error("Não foi possível preparar a foto.");
      ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      const blob=await new Promise<Blob|null>((resolve)=>canvas.toBlob(resolve,"image/webp",quality));canvas.width=0;canvas.height=0;
      if(blob && blob.size<=MAX_PRODUCT_PHOTO_BYTES) return new File([blob],`${crypto.randomUUID()}.webp`,{type:blob.type,lastModified:Date.now()});
    }
    throw new Error("A foto não coube no limite de envio. Escolha uma imagem menor.");
  } finally{bitmap.close();}
}
export function ProductGallery({photos,onChange,busy,onBusyChange,disabled}:{photos:GalleryPhoto[];onChange:(photos:GalleryPhoto[])=>void;busy:boolean;onBusyChange:(busy:boolean)=>void;disabled:boolean}) {
  const input=useRef<HTMLInputElement>(null); const working=useRef(false); const urls=useRef<string[]>([]);
  useEffect(()=>()=>{urls.current.forEach((url)=>URL.revokeObjectURL(url));},[]);
  const add=useCallback(async(files:File[])=>{
    if(disabled || working.current)return;
    const available=MAX_PRODUCT_PHOTOS-photos.length;if(available<=0){toast.error("A galeria aceita até 6 fotos.");return;}
    const accepted=files.slice(0,available);if(files.length>available)toast.info(`Serão adicionadas as primeiras ${available} fotos.`);
    working.current=true;onBusyChange(true); const added:GalleryPhoto[]=[];
    try {
      for(const file of accepted){const optimized=await optimizeProductPhoto(file);const url=URL.createObjectURL(optimized);urls.current.push(url);added.push({key:crypto.randomUUID(),file:optimized,url});}
      onChange([...photos,...added]);
    } catch(error){added.forEach((photo)=>{URL.revokeObjectURL(photo.url);urls.current=urls.current.filter((url)=>url!==photo.url);});toast.error(error instanceof Error?error.message:"Não foi possível preparar as fotos.");}
    finally{working.current=false;onBusyChange(false);}
  },[disabled,onBusyChange,onChange,photos]);
  useEffect(()=>{
    if(disabled)return;
    const paste=(event:ClipboardEvent)=>{const files=Array.from(event.clipboardData?.items ?? []).filter((item)=>item.kind==="file" && item.type.startsWith("image/")).map((item)=>item.getAsFile()).filter((file):file is File=>file!==null);if(files.length){event.preventDefault();void add(files);}};
    document.addEventListener("paste",paste);return()=>document.removeEventListener("paste",paste);
  },[add,disabled]);
  return <div className="space-y-3" onDragOver={(event)=>{if(!disabled)event.preventDefault();}} onDrop={(event)=>{event.preventDefault();if(!disabled)void add(Array.from(event.dataTransfer.files));}}>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{photos.map((photo,index)=><div key={photo.key} className={`relative overflow-hidden rounded-xl border bg-white ${index===0?"col-span-2 row-span-2":""}`}><Image src={photo.url} alt={`Foto ${index+1} do produto`} width={480} height={480} unoptimized className="aspect-square w-full object-contain p-2" /><div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-black/70 p-1.5 text-white"><button type="button" disabled={disabled || busy || index===0} onClick={()=>onChange([photo,...photos.filter((item)=>item!==photo)])} className="flex items-center gap-1 rounded px-1 py-1 text-[10px] disabled:opacity-80" aria-label={index===0?"Foto de capa":`Definir foto ${index+1} como capa`}><Star className="size-3" />{index===0?"Capa":"Usar como capa"}</button>{!disabled && <button type="button" disabled={busy} aria-label={`Remover foto ${index+1}`} className="rounded p-1 hover:bg-white/20" onClick={()=>{if(photo.file){URL.revokeObjectURL(photo.url);urls.current=urls.current.filter((url)=>url!==photo.url);}onChange(photos.filter((item)=>item!==photo));}}><Trash2 className="size-3.5" /></button>}</div></div>)}
      {!disabled && photos.length<MAX_PRODUCT_PHOTOS && <button type="button" disabled={busy} onClick={()=>input.current?.click()} className={`flex min-h-32 flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-6 text-sm text-muted-foreground hover:border-ouro hover:bg-amarelo/5 ${photos.length===0?"col-span-2 sm:col-span-3":""}`}><ImagePlus className="size-7 text-ouro-ink" /><span className="font-medium">{busy?"Otimizando fotos…":"Adicionar fotos"}</span><span className="text-center text-xs">Arraste imagens ou cole com Ctrl+V</span></button>}
    </div>
    <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif" className="hidden" disabled={disabled || busy} aria-label="Selecionar fotos do produto" onChange={(event)=>{const files=Array.from(event.target.files ?? []);event.target.value="";void add(files);}} />
    <p className="text-xs text-muted-foreground">{photos.length}/6 fotos · A primeira imagem é a capa. Otimizamos as fotos antes do envio.{busy?" Aguarde a otimização para salvar.":""}</p>
    {disabled && photos.length===0 && <p className="text-sm text-muted-foreground">Este produto ainda não tem fotos.</p>}
    {!disabled && photos.length>1 && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={()=>input.current?.click()}>Adicionar mais fotos</Button>}
  </div>;
}
