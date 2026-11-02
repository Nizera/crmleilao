import { z } from 'zod';

export const bannerSchema = z.object({
  title: z.string().trim().min(2).max(100),
  subtitle: z.string().trim().max(220),
  button_label: z.string().trim().min(2).max(32),
  button_href: z.string().max(500).refine(value => value === '#catalogo-loja' || /^\/painel\/loja(?:\?[a-zA-Z0-9%&=+_.~-]*)?$/.test(value), 'Use um link da própria loja.'),
  active: z.boolean(),
});
export type StoreBanner = z.infer<typeof bannerSchema> & { id: boolean; desktop_path: string | null; mobile_path: string | null; updated_at: string };
export const defaultBanner = { title: 'Sua coleção merece o próximo destaque.', subtitle: 'Explore os colecionáveis e transforme suas Caracoins em novas possibilidades.', button_label: 'Explorar produtos', button_href: '#catalogo-loja', active: true, desktop_path: null, mobile_path: null };
export const bannerImageUrl = (path: string) => `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/lot-images/${path}`;
export type CatalogFilters = { q: string; category: string; mode: string; sort: string; min: string; max: string; available: boolean };
export function catalogFiltersFrom(params: Record<string, string | string[] | undefined>): CatalogFilters {
  const get = (key: string) => { const v = params[key]; return (Array.isArray(v) ? v[0] : v) ?? ''; };
  const mode = ['cash', 'coins'].includes(get('mode')) ? get('mode') : '';
  const price = (key: string) => mode && /^\d{1,7}(\.\d{1,2})?$/.test(get(key)) ? get(key) : '';
  return { q: get('q').trim().slice(0, 100), category: get('category').slice(0, 60), mode, sort: ['cash', 'cash_desc', 'coins', 'coins_desc', 'name'].includes(get('sort')) ? get('sort') : 'newest', min: price('min'), max: price('max'), available: get('available') === '1' };
}
