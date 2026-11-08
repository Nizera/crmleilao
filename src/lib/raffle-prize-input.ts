import { z } from "zod";
export function instantPrizeBatchSchema(prefix: string) {
  return z.object({ campaign: z.uuid(), key: z.uuid(), items: z.array(z.object({
    title: z.string().trim().min(1, "Informe o nome do prêmio.").max(160),
    quantity: z.number().int().min(1).max(100),
    image_urls: z.array(z.url().max(2000).refine(url => url.startsWith(prefix), "Use fotos enviadas pelo app.")).max(4),
  })).min(1).max(100) }).refine(value => value.items.reduce((sum, item) => sum + item.quantity, 0) <= 100, "Adicione no máximo 100 prêmios por vez.");
}
