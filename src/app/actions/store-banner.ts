'use server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { bannerSchema } from '@/lib/store-presentation';
import { isProductImageContent } from '@/lib/store-admin';
import { rethrowIfRedirect, type ActionResult } from '@/lib/result';
import { allow } from '@/lib/ratelimit';

export async function saveStoreBanner(form: FormData): Promise<ActionResult> {
  const uploaded: string[] = [];
  let committed = false;
  let admin: ReturnType<typeof createAdminClient> | null = null;
  try {
    const { profile } = await requireAdmin();
    if (profile.role === 'viewer' || !await allow('store-catalog-write', profile.id)) return { ok: false, error: 'Sem permissão ou limite de alterações atingido.' };
    admin = createAdminClient();
    const parsed = bannerSchema.safeParse({ ...Object.fromEntries(['title', 'subtitle', 'button_label', 'button_href'].map(k => [k, form.get(k)])), active: form.get('active') === 'on' });
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    const { data: current, error } = await admin.from('store_banner').select('*').eq('id', true).single();
    if (error || !current) return { ok: false, error: 'Confira a migration 0038 antes de cadastrar o banner.' };
    if (form.get('updated_at') !== current.updated_at) return { ok: false, error: 'O banner mudou. Atualize a página antes de salvar.' };
    const images: Record<string, string | null> = { desktop_path: current.desktop_path, mobile_path: current.mobile_path };
    const files = ['desktop', 'mobile'].map(slot => ({ slot, file: form.get(slot) }));
    for (const { file } of files) {
      if (file instanceof File && file.size && (file.size > 600000 || !isProductImageContent(new Uint8Array(await file.slice(0, 32).arrayBuffer()), file.type))) return { ok: false, error: 'Use imagens JPG, PNG ou WebP de até 600 KB.' };
    }
    for (const { slot, file } of files) {
      if (form.get(`remove_${slot}`) === 'on') images[`${slot}_path`] = null;
      if (file instanceof File && file.size) {
        const ext = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp';
        const path = `store-banners/${crypto.randomUUID()}.${ext}`;
        const { error } = await admin.storage.from('lot-images').upload(path, file, { contentType: file.type, upsert: false });
        if (error) throw new Error('upload');
        uploaded.push(path); images[`${slot}_path`] = path;
      }
    }
    const result = await admin.from('store_banner').update({ ...parsed.data, ...images, updated_at: new Date().toISOString() }).eq('id', true).eq('updated_at', current.updated_at).select('id');
    if (result.error || !result.data?.length) throw new Error('save');
    committed = true;
    // Imagens anteriores permanecem válidas para páginas abertas e caches.
    revalidatePath('/painel/loja'); revalidatePath('/admin/fidelidade/banners');
    return { ok: true, data: null };
  } catch (error) {
    if (!committed && uploaded.length && admin) await admin.storage.from('lot-images').remove(uploaded);
    rethrowIfRedirect(error);
    return { ok: false, error: 'Não foi possível salvar o banner. Tente novamente.' };
  }
}
