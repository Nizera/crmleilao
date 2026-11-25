import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { spToday } from '@/lib/dates';
import { nextShippingDate } from '@/lib/lots';

export async function getStoreShippingPreview(): Promise<string | null> {
  try {
    const { data, error } = await createAdminClient().from('app_settings')
      .select('shipping_weekday').eq('id', true).maybeSingle();
    const day = data?.shipping_weekday;
    if (error || typeof day !== 'number' || !Number.isInteger(day) || day < 0 || day > 6) return null;
    return nextShippingDate(spToday(), day);
  } catch {
    return null;
  }
}

