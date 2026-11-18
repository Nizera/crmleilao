import {createHash,timingSafeEqual} from 'node:crypto';
import {flushMetaConversions} from '@/lib/meta-conversions-server';
export const maxDuration=60;
export async function GET(request:Request){
 const secret=process.env.CRON_SECRET?.trim(),received=request.headers.get('authorization')??'';
 if(!secret||!timingSafeEqual(createHash('sha256').update(received).digest(),createHash('sha256').update(`Bearer ${secret}`).digest()))return Response.json({error:'unauthorized'},{status:401});
 try{return Response.json(await flushMetaConversions(5));}catch{return Response.json({error:'queue_unavailable'},{status:503});}
}
