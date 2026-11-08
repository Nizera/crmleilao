import "server-only";
import {getOrder,targetChargeStatus} from "@/lib/mercadopago";
import {createAdminClient} from "@/lib/supabase/admin";
import {cancelCharge,getChargeById,recoverChargeOrder,syncChargeWithMp} from "@/lib/charges-server";

/** Nunca cancela lotes antes de encerrar o Pix real; lotes mais novos continuam elegíveis. */
export async function reconcileAuctionDeadlines(budgetMs=40000){
 const db=createAdminClient();const started=Date.now();let cancelled=0,failed=0,checked=0,recoveryChecked=0;
 const recovery=await db.from('charges').select('id').in('status',['pending','in_process']).not('pix_issue_since','is',null).lt('pix_attempts',4).or(`pix_last_attempt_at.is.null,pix_last_attempt_at.lte.${new Date(Date.now()-300000).toISOString()}`).order('pix_last_attempt_at',{ascending:true,nullsFirst:true}).limit(2);
 if(recovery.error)throw new Error('Fila de recuperação do Pix indisponível.');
 for(const charge of recovery.data??[]){if(Date.now()-started>budgetMs-12000)break;recoveryChecked++;try{await syncChargeWithMp(charge.id,true);}catch{failed++;}}
 const notice=await db.rpc("notify_auction_payment_deadlines");if(notice.error)throw new Error("Avisos de pagamento indisponíveis.");
 const handled=new Set<string>();
 while(Date.now()-started<budgetMs-1500){
  const {data,error}=await db.rpc("claim_auction_payment_expirations",{p_limit:3});if(error)throw new Error("Fila de expiração indisponível.");if(!data?.length)break;
  for(const lot of data){
   if(Date.now()-started>budgetMs-1000)break;
   checked++;
   try{
    if(lot.charge_id&&!handled.has(lot.charge_id)){
     let charge=await getChargeById(lot.charge_id);
     const signal=AbortSignal.timeout(Math.max(500,Math.min(12000,budgetMs-(Date.now()-started)-500)));
     if(charge&&!charge.mp_payment_id&&(charge.status==='pending'||charge.status==='in_process')){await recoverChargeOrder(charge.id,signal);charge=await getChargeById(charge.id);}
     if(!charge)throw new Error("Cobrança indisponível.");
     if(charge.status==='pending'||charge.status==='in_process'){
      const result=await cancelCharge(charge.id,signal);
      if(!result.ok&&result.reason!=='already_approved')throw new Error("Encerramento do Pix não confirmado.");
     }else if(charge.status==='approved'){
      // Não cancela nem desvincula um pagamento confirmado.
      failed++;continue;
     }else{
      // A rotina normal de sincronização é quem libera vínculos terminais.
      const remote=charge.mp_payment_id?await getOrder(charge.mp_payment_id,signal):null;
      const target=remote?targetChargeStatus(remote.status,remote.statusDetail):null;
      if(!remote||!target||target==='approved')throw new Error("Não foi possível confirmar o encerramento.");
      const released=await db.rpc('release_closed_auction_charge',{p_charge:charge.id,p_remote_id:remote.id,p_reference:remote.externalReference,p_amount:remote.amount,p_status:target});
      if(released.error||!released.data)throw new Error("Não foi possível liberar o vínculo encerrado.");
     }
     handled.add(lot.charge_id);
    }
    const result=await db.rpc("expire_unpaid_auction_lot",{p_lot:lot.id});if(result.error)throw result.error;
    if(result.data)cancelled++;
   }catch{failed++;}
  }
 }
 return {checked,cancelled,failed,recoveryChecked,notifications:Number(notice.data??0)};
}
