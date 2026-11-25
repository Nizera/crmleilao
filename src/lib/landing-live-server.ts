import 'server-only';
import { storeProductImageUrl } from '@/lib/store-presentation';
import {createAdminClient} from '@/lib/supabase/admin';
import {lotImageUrl} from '@/lib/lots';
import {priceLabel} from '@/lib/store';
import type {StoreProduct} from '@/lib/store';
import {LANDING_LIVE_CHANNEL,type LandingSnapshot} from '@/lib/landing-live';
export async function loadLandingSnapshot():Promise<LandingSnapshot>{
 const db=createAdminClient();
 const [lots,catalog]=await Promise.all([
 db.from('lots').select('id,title,images,created_at').neq('status','cancelled').order('created_at',{ascending:false}).order('id',{ascending:false}).limit(8),
 db.rpc('get_public_store_catalog',{p_available:true,p_sort:'newest',p_page:1})
 ]);
 if(lots.error)console.warn('[landing] lots unavailable',lots.error.code,lots.error.message);
 if(catalog.error)console.warn('[landing] store unavailable',catalog.error.code,catalog.error.message);
 const products:StoreProduct[]=catalog.error?[]:catalog.data?.items??[];
 return {lotsAvailable:!lots.error,storeAvailable:!catalog.error,
 lots:(lots.data??[]).map(l=>({id:l.id,title:l.title,image:lotImageUrl(l.images?.[0]),created_at:l.created_at})),
 products:products.filter(p=>p.image_path).sort((a,b)=>Number(/legend/i.test(b.category??''))-Number(/legend/i.test(a.category??''))).slice(0,6).map(p=>({id:p.id,name:p.name,image:p.image_path ? storeProductImageUrl(p.image_path) : null,category:p.category??'Colecionável',price:priceLabel(Number(p.cash_price??0),Number(p.points_cost??0))}))};
}
/** Broadcast only an invalidation signal, never customer or payment data. */
export async function notifyLandingChanged(){
 const db=createAdminClient();const channel=db.channel(LANDING_LIVE_CHANNEL);
 try{await channel.httpSend('catalog-changed',{}, {timeout:2500});}catch{/* Periodic refresh recovers lost signals. */}
 finally{await db.removeChannel(channel).catch(()=>{});}
}
