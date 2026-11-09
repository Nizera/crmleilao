import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import {createAdminClient} from "@/lib/supabase/admin";
import {getOrder,mpFailureCodes,qrFrom} from "@/lib/mercadopago";

export const maxDuration=20;
const machineCode=(value:unknown)=>typeof value==="string"&&/^[a-zA-Z0-9_-]{1,100}$/.test(value)?value:null;
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"private, no-store"}});

// Read-only operations endpoint. The signature is bound to one charge and expires
// in 90 seconds; no user contacts, QR contents, credentials or amounts are returned.
export async function GET(request:Request){
 const secret=process.env.CRON_SECRET?.trim();
 const charge=new URL(request.url).searchParams.get("charge")??"";
 const timestamp=request.headers.get("x-pix-diagnostic-time")??"";
 if(!secret||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(charge)||!/^\d{10}$/.test(timestamp)||Math.abs(Date.now()/1000-Number(timestamp))>90)return reply({error:"unauthorized"},401);
 const expected=`Bearer ${createHmac("sha256",secret).update(`pix-diagnostic:${charge}:${timestamp}`).digest("hex")}`;
 if(!timingSafeEqual(createHash("sha256").update(expected).digest(),createHash("sha256").update(request.headers.get("authorization")??"").digest()))return reply({error:"unauthorized"},401);
 try{
  const {data:local,error}=await createAdminClient().from("charges").select("status,mp_payment_id,external_reference,amount").eq("id",charge).maybeSingle();
  if(error)throw error;
  if(!local)return reply({error:"not_found"},404);
  if(!local.mp_payment_id)return reply({localStatus:local.status,providerOrder:false});
  const remote=await getOrder(local.mp_payment_id);
  if(!remote)return reply({localStatus:local.status,providerOrder:true,providerFound:false});
  return reply({localStatus:local.status,providerOrder:true,providerFound:true,status:machineCode(remote.status),detail:machineCode(remote.statusDetail),codes:mpFailureCodes(remote.raw),payments:remote.raw.transactions?.payments?.map(p=>({status:machineCode(p.status),detail:machineCode(p.status_detail)})).slice(0,5)??[],referenceMatches:remote.externalReference===local.external_reference,amountMatches:Math.round(remote.amount*100)===Math.round(Number(local.amount)*100),hasQr:Boolean(qrFrom(remote.raw).qrCode)});
 }catch{return reply({error:"provider_lookup_unavailable"},503);}
}
