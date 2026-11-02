"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveRafflePhotos, uploadRaffleImage } from "@/app/actions/raffles";
import { rafflePhotos } from "@/lib/raffle-photos";
import type { Raffle } from "@/lib/raffles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function RafflePhotoEditor({ campaign }: { campaign: Raffle }) {
  const [photos, setPhotos] = useState(() => rafflePhotos(campaign));
  const [pending, start] = useTransition();
  const router = useRouter();
  return <section className="grid min-w-0 gap-4 rounded-xl border p-5">
    <div><h2 className="font-bold">Fotos da campanha e do prêmio</h2><p className="mt-1 text-sm text-muted-foreground">Até seis fotos. A primeira é a capa. Elas também aparecem em Meus prêmios para o ganhador.</p></div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{photos.map((url, i) => <div key={url} className="grid min-w-0 gap-2 rounded-lg border p-2"><picture><img src={url} alt={`Foto ${i + 1}`} className="aspect-square w-full object-contain" referrerPolicy="no-referrer" /></picture><span className="text-xs">{i === 0 ? "Capa" : `Foto ${i + 1}`}</span><div className="flex flex-wrap gap-2">{i > 0 && <Button size="sm" variant="outline" disabled={pending} onClick={() => setPhotos(current => [url, ...current.filter(p => p !== url)])}>Usar como capa</Button>}<Button size="sm" variant="outline" disabled={pending} onClick={() => setPhotos(current => current.filter(p => p !== url))}>Remover</Button></div></div>)}</div>
    <label className="grid gap-2 text-sm">Adicionar fotos (JPG, PNG ou WebP de até 1 MB cada)
      <Input type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={pending || photos.length >= 6} onChange={event => {
        const files = Array.from(event.target.files ?? []); event.target.value = "";
        if (files.length + photos.length > 6) { toast.error("Selecione no máximo seis fotos no total."); return; }
        start(async () => {
          const added: string[] = [];
          for (const file of files) {
            const form = new FormData(); form.set("file", file);
            const result = await uploadRaffleImage(form);
            if (!result.ok) { toast.error(result.error); break; }
            added.push(result.data);
          }
          setPhotos(current => [...new Set([...current, ...added])].slice(0, 6));
        });
      }} />
    </label>
    <Button disabled={pending} onClick={() => start(async () => {
      const result = await saveRafflePhotos(campaign.id, photos);
      if (!result.ok) toast.error(result.error);
      else { toast.success("Fotos salvas."); router.refresh(); }
    })}>{pending ? "Aguarde…" : "Salvar fotos"}</Button>
  </section>;
}
