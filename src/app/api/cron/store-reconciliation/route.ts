import { createHash, timingSafeEqual } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { reconcileStoreOrders } from '@/lib/store-server';
import { reconcileRafflePayments } from '@/lib/raffles-server';

export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const expected = secret ? `Bearer ${secret}` : '';
  const received = request.headers.get('authorization') ?? '';
  if (!expected || !timingSafeEqual(createHash('sha256').update(expected).digest(), createHash('sha256').update(received).digest())) {
    return Response.json({error:'unauthorized'}, {status:401});
  }
  try {
    const started = Date.now();
    const expiration = await createAdminClient().rpc('expire_due_caracoins',{p_limit:200});
    if(expiration.error) throw new Error('Caracoins expiration unavailable');
    const result = await reconcileStoreOrders();
    // Reaproveita a chamada diária; o webhook continua sendo a confirmação imediata.
    const remaining = 53000 - (Date.now() - started);
    const raffles = remaining > 1500 ? await reconcileRafflePayments(Math.min(18000, remaining)) : { checked: 0, failed: 0 };
    revalidatePath('/painel', 'layout');
    revalidatePath('/admin/fidelidade', 'layout');
    revalidatePath('/painel/rifas', 'layout');
    revalidatePath('/admin/rifa', 'layout');
    return Response.json({ ...result, raffles });
  } catch {
    return Response.json({error:'reconciliation_unavailable'}, {status:503});
  }
}
