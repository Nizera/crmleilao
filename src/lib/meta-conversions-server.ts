import 'server-only';
import {createHash} from 'node:crypto';
import {cookies} from 'next/headers';
import {createAdminClient} from '@/lib/supabase/admin';
import {MARKETING_COOKIE} from '@/lib/meta-commerce';

export const validMarketingSession=(id:string|undefined)=>!!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
export function metaConfiguration() {
 const pixel=process.env.META_PIXEL_ID?.trim(),token=process.env.META_CONVERSIONS_ACCESS_TOKEN?.trim();
 return {pixel:pixel&&/^\d{5,30}$/.test(pixel)?pixel:null,token:token||null,
   enabled:process.env.VERCEL_ENV==='production'&&process.env.META_TRACKING_DISABLED!=='true',
   version:/^v\d+\.0$/.test(process.env.META_GRAPH_VERSION??'')?process.env.META_GRAPH_VERSION!:'v25.0'};
}
export async function attachStoreMarketing(orderId:string,customerId:string) {
 const id=(await cookies()).get(MARKETING_COOKIE)?.value;
 if(!validMarketingSession(id)||!metaConfiguration().enabled)return;
 const {error}=await createAdminClient().rpc('attach_store_marketing',{p_order:orderId,p_customer:customerId,p_session:id});
 if(error)throw new Error('marketing_attribution_unavailable');
}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export async function flushMetaConversions(limit=5) {
 const config=metaConfiguration();
 if(!config.enabled||!config.pixel||!config.token)return {sent:0,failed:0,configured:false};
 const db=createAdminClient();
 const {data:events,error}=await db.rpc('claim_store_meta_events',{p_limit:Math.max(1,Math.min(limit,5))});
 if(error)throw new Error('marketing_queue_unavailable');
 let sent=0,failed=0;
 for(const event of events??[]) {
  try {
   const {data:link,error:linkError}=await db.from('store_order_attribution').select('session_id').eq('order_id',event.order_id).single();
   if(linkError||!link)throw new Error('attribution_unavailable');
   const [{data:session,error:sessionError},{data:order,error:orderError}]=await Promise.all([
    db.from('store_marketing_sessions').select('consent,expires_at,source_url,user_agent,fbp,fbc').eq('id',link.session_id).single(),
    db.from('store_orders').select('payment_status,customer_id').eq('id',event.order_id).single()]);
   if(sessionError||orderError)throw new Error('context_unavailable');
   if(!session?.consent||Date.parse(session.expires_at)<=Date.now()||order?.payment_status!=='paid'){
    await db.from('store_meta_events').update({status:'skipped',error_code:'consent_or_payment_unavailable'}).eq('id',event.id).eq('lease_token',event.lease_token);continue;
   }
   const {data:customer,error:customerError}=await db.from('customers').select('email,phone_e164').eq('id',order.customer_id).single();
   if(customerError)throw new Error('customer_unavailable');
   const email=customer?.email?.trim().toLowerCase(),phone=customer?.phone_e164?.replace(/\D/g,'');
   const user:Record<string,unknown>={external_id:[hash(order.customer_id)],client_user_agent:session.user_agent};
   if(email)user.em=[hash(email)];if(phone)user.ph=[hash(phone)];
   if(session.fbp)user.fbp=session.fbp;if(session.fbc)user.fbc=session.fbc;
   const payload={event_name:'Purchase',event_id:event.event_id,event_time:Math.floor(Date.parse(event.event_time)/1000),
    action_source:'website',event_source_url:session.source_url,user_data:user,custom_data:event.payload};
   const response=await fetch(`https://graph.facebook.com/${config.version}/${config.pixel}/events`,{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.token}`},
    body:JSON.stringify({data:[payload],...(process.env.META_TEST_EVENT_CODE?{test_event_code:process.env.META_TEST_EVENT_CODE}: {})}),
    cache:'no-store',signal:AbortSignal.timeout(6000)});
   const result=await response.json().catch(()=>null);
   if(!response.ok||result?.events_received!==1)throw new Error(`meta_${Number(result?.error?.code)||response.status}`);
   const {error:saveError}=await db.from('store_meta_events').update({status:'sent',sent_at:new Date().toISOString(),error_code:null,trace_id:typeof result.fbtrace_id==='string'?result.fbtrace_id.slice(0,150):null}).eq('id',event.id).eq('lease_token',event.lease_token);
   if(saveError)throw new Error('delivery_ack_unavailable');
   sent++;
  }catch(error){
   failed++;
   const code=error instanceof Error&&/^(meta_\d+|[a-z_]+_unavailable)$/.test(error.message)?error.message:'delivery_unavailable';
   await db.from('store_meta_events').update({status:event.attempts>=10?'failed':'pending',error_code:code,
    next_attempt_at:new Date(Date.now()+Math.min(6*3600000,60000*2**event.attempts)).toISOString()}).eq('id',event.id).eq('lease_token',event.lease_token);
  }
 }
 return {sent,failed,configured:true};
}
