import {after,NextRequest,NextResponse} from 'next/server';
import {createAdminClient} from '@/lib/supabase/admin';
import {allow} from '@/lib/ratelimit';
import {cleanAttribution,cleanMetaId,CONSENT_DAYS,CONSENT_VERSION,isStoreMarketingPath,MARKETING_COOKIE} from '@/lib/meta-commerce';
import {flushMetaConversions,metaConfiguration,validMarketingSession} from '@/lib/meta-conversions-server';
export const maxDuration=60;
export async function GET(){const c=metaConfiguration();return NextResponse.json({enabled:c.enabled,pixelId:c.pixel,serverConfigured:!!c.token},{headers:{'Cache-Control':'no-store'}});}
export async function POST(request:NextRequest) {
 if(request.headers.get('origin')!==request.nextUrl.origin)return NextResponse.json({error:'origin'},{status:403});
 if(!metaConfiguration().enabled)return NextResponse.json({enabled:false});
 const raw=await request.text();if(raw.length>4096)return NextResponse.json({error:'size'},{status:413});
 let input:Record<string,unknown>;try{input=JSON.parse(raw);}catch{return NextResponse.json({error:'invalid'},{status:400});}
 if(!input||typeof input!=='object'||typeof input.consent!=='boolean')return NextResponse.json({error:'invalid'},{status:400});
 const previousId=request.cookies.get(MARKETING_COOKIE)?.value;
 const id=validMarketingSession(previousId)?previousId!:crypto.randomUUID();
 if((input.consent||!validMarketingSession(previousId))&&!await allow('store-marketing',id))return NextResponse.json({error:'rate'},{status:429});
 const db=createAdminClient();
 const {data:previous,error:readError}=await db.from('store_marketing_sessions').select('source_url,attribution,fbp,fbc,consent,expires_at').eq('id',id).maybeSingle();
 if(readError)return NextResponse.json({error:'unavailable'},{status:503});
 const consent=input.consent,sourcePath=typeof input.source_path==='string'&&isStoreMarketingPath(input.source_path)?input.source_path:'/loja';
 const keep=previous?.consent&&Date.parse(previous.expires_at)>Date.now();
 const values={id,consent,consent_version:CONSENT_VERSION,updated_at:new Date().toISOString(),
  expires_at:keep?previous.expires_at:new Date(Date.now()+CONSENT_DAYS*86400000).toISOString(),
  source_url:consent?(keep?previous.source_url:request.nextUrl.origin+sourcePath):null,
  user_agent:consent?(request.headers.get('user-agent')??'').slice(0,500):null,
  attribution:consent?(keep?previous.attribution:cleanAttribution(input.attribution)):{},
  fbp:consent?(cleanMetaId(input.fbp)??(keep?previous.fbp:null)):null,
  fbc:consent?(cleanMetaId(input.fbc)??(keep?previous.fbc:null)):null};
 // A delayed page refresh cannot reactivate consent after an explicit refusal.
 const {error}=input.refresh===true&&previous
  ?await db.from('store_marketing_sessions').update(values).eq('id',id).eq('consent',true)
  :await db.from('store_marketing_sessions').upsert(values);
 if(error)return NextResponse.json({error:'unavailable'},{status:503});
 if(!consent){
  // Preserve the refusal in a necessary first-party cookie, clear advertising identifiers.
  const {data:links}=await db.from('store_order_attribution').select('order_id').eq('session_id',id);
  if(links?.length)await db.from('store_meta_events').update({status:'skipped',error_code:'consent_revoked'}).in('order_id',links.map(x=>x.order_id)).in('status',['pending','processing']);
 }
 const response=NextResponse.json({ok:true,consent});
 response.headers.set('Cache-Control','no-store');
 response.cookies.set(MARKETING_COOKIE,id,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:CONSENT_DAYS*86400});
 if(consent)after(async()=>{await flushMetaConversions(3).catch(()=>{});});
 return response;
}
