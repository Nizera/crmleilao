import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {metaConfiguration} from '@/lib/meta-conversions-server';
export const maxDuration=20;
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});

/** Operations-only test. Always sends test_event_code; never creates orders or live conversions. */
export async function POST(request:Request){
 const secret=process.env.CRON_SECRET?.trim(),timestamp=request.headers.get('x-meta-test-time')??'';
 if(!secret||!/^\d{10}$/.test(timestamp)||Math.abs(Date.now()/1000-Number(timestamp))>90)return reply({error:'unauthorized'},401);
 const raw=await request.text();if(raw.length>512)return reply({error:'invalid'},400);
 const digest=createHash('sha256').update(raw).digest('hex');
 const expected=`Bearer ${createHmac('sha256',secret).update(`meta-test:${timestamp}:${digest}`).digest('hex')}`;
 if(!timingSafeEqual(createHash('sha256').update(expected).digest(),createHash('sha256').update(request.headers.get('authorization')??'').digest()))return reply({error:'unauthorized'},401);
 let data:{testCode?:unknown;eventId?:unknown};try{data=JSON.parse(raw);}catch{return reply({error:'invalid'},400);}
 if(!data||typeof data.testCode!=='string'||!/^TEST\d{3,20}$/.test(data.testCode)||typeof data.eventId!=='string'||!/^ocdl_meta_test_[0-9a-f-]{36}$/i.test(data.eventId))return reply({error:'invalid'},400);
 const config=metaConfiguration();if(!config.enabled||!config.pixel||!config.token)return reply({error:'not_configured'},503);
 const event={event_name:'Purchase',event_id:data.eventId,event_time:Math.floor(Date.now()/1000),action_source:'website',
  event_source_url:'https://www.oscarasdaslegends.com.br/loja',
  user_data:{external_id:[createHash('sha256').update(data.eventId).digest('hex')],client_user_agent:'OCDL integration test'},
  custom_data:{currency:'BRL',value:45,content_type:'product',content_ids:['ocdl-integration-test'],contents:[{id:'ocdl-integration-test',quantity:1,item_price:45}],num_items:1,order_id:data.eventId}};
 try{
  const response=await fetch(`https://graph.facebook.com/${config.version}/${config.pixel}/events`,{method:'POST',
   headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.token}`},
   body:JSON.stringify({data:[event],test_event_code:data.testCode}),cache:'no-store',signal:AbortSignal.timeout(10000)});
  const result=await response.json().catch(()=>null);
  if(!response.ok||result?.events_received!==1)return reply({error:'meta_rejected',code:Number(result?.error?.code)||response.status},502);
  return reply({ok:true,testCode:data.testCode,eventId:data.eventId,eventsReceived:result.events_received,traceId:typeof result.fbtrace_id==='string'?result.fbtrace_id.slice(0,150):null});
 }catch{return reply({error:'meta_unavailable'},503);}
}
