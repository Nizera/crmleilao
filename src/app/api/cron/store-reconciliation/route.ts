import { createHash, timingSafeEqual } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { reconcileStoreOrders } from '@/lib/store-server';

export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const expected = secret ? `Bearer ${secret}` : '';
  const received = request.headers.get('authorization') ?? '';
  if (!expected || !timingSafeEqual(createHash('sha256').update(expected).digest(), createHash('sha256').update(received).digest())) {
    return Response.json({error:'unauthorized'}, {status:401});
  }
  try {
    const result = await reconcileStoreOrders();
    revalidatePath('/painel', 'layout');
    revalidatePath('/admin/fidelidade', 'layout');
    return Response.json(result);
  } catch {
    return Response.json({error:'reconciliation_unavailable'}, {status:503});
  }
}
