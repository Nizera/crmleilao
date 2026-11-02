"use server";

import {isLocalStorePilot,storePurchasesEnabled} from "@/lib/store-settings-server";
import {z} from "zod";
import {revalidatePath} from "next/cache";
import {requireAdmin,requireCustomer} from "@/lib/dal";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {allow} from "@/lib/ratelimit";
import {STORE_PREVIEW_MESSAGE} from "@/lib/store-availability";
import {rethrowIfRedirect,type ActionResult} from "@/lib/result";
import {parseCatalogNumber} from "@/lib/store-admin";
const amount=(min:number)=>z.preprocess(parseCatalogNumber,z.number().finite().min(min).max(9999999).nullable());
const schema=z.object({name:z.string().trim().min(2).max(120),coins_cost:amount(.01),discount_cash:amount(.01),min_purchase:amount(0),validity_days:z.coerce.number().int().min(1).max(365),max_redemptions:amount(1),max_per_customer:z.coerce.number().int().min(1).max(10000),active:z.boolean(),eligible_product_ids:z.array(z.uuid()).max(100)}).superRefine((v,ctx)=>{if(v.active&&(v.coins_cost===null||v.discount_cash===null))ctx.addIssue({code:'custom',message:'Informe custo em Caracoins e desconto em reais antes de ativar.'});if(v.max_redemptions!==null&&!Number.isInteger(v.max_redemptions))ctx.addIssue({code:'custom',message:'Limite deve ser inteiro.'});});
function refresh(){revalidatePath('/painel/loja');revalidatePath('/admin/fidelidade/vouchers');revalidatePath('/admin/fidelidade/extrato');}
export async function saveVoucherTemplate(form:FormData):Promise<ActionResult>{
 try{
  const {profile}=await requireAdmin();if(profile.role==='viewer'||!await allow('store-catalog-write',profile.id))return {ok:false,error:'Sem permissão ou limite de alterações atingido.'};
  const id=String(form.get('id')??'');if(id&&!z.uuid().safeParse(id).success)return {ok:false,error:'Voucher inválido.'};
  const parsed=schema.safeParse(Object.fromEntries([...['name','coins_cost','discount_cash','min_purchase','validity_days','max_redemptions','max_per_customer'].map(key=>[key,form.get(key)]),['active',form.get('active')==='on'],['eligible_product_ids',form.getAll('eligible_product_ids')]]));
  if(!parsed.success)return {ok:false,error:parsed.error.issues[0]?.message??'Revise as regras.'};
  const admin=createAdminClient();
  if(parsed.data.eligible_product_ids.length){const {data,error}=await admin.from('loyalty_rewards').select('id,cash_price,points_cost').in('id',parsed.data.eligible_product_ids);if(error||data?.length!==parsed.data.eligible_product_ids.length||data.some(p=>!p.cash_price||p.points_cost))return {ok:false,error:'Selecione apenas produtos com preço exclusivo em reais.'};}
  const row={...parsed.data,min_purchase:parsed.data.min_purchase??0,updated_at:new Date().toISOString()};
  const result=id?await admin.from('store_voucher_templates').update(row).eq('id',id).eq('updated_at',String(form.get('updated_at')??'')).select('id'):await admin.from('store_voucher_templates').insert(row).select('id');
  if(result.error||!result.data?.length)return {ok:false,error:'Não foi possível salvar. Confira a migration 0037 ou atualize a versão do voucher.'};
  refresh();return {ok:true,data:null};
 }catch(error){rethrowIfRedirect(error);return {ok:false,error:'Não foi possível salvar o voucher.'};}
}
export async function redeemVoucher(templateId:string,requestKey:string):Promise<ActionResult>{
 try{
  const {customer}=await requireCustomer();if(!await storePurchasesEnabled(customer.id))return {ok:false,error:STORE_PREVIEW_MESSAGE};
  if(!z.uuid().safeParse(templateId).success||!z.uuid().safeParse(requestKey).success)return {ok:false,error:'Voucher inválido.'};
  if(!await allow('store-checkout',customer.id))return {ok:false,error:'Aguarde um pouco antes de tentar novamente.'};
  const db=await createClient();const {error}=await isLocalStorePilot(customer.id)?await createAdminClient().rpc('run_local_store_pilot',{p_customer:customer.id,p_operation:'voucher',p_template:templateId,p_request_key:requestKey}):await db.rpc('redeem_store_voucher',{p_template:templateId,p_request_key:requestKey});
  if(error?.code==='PGRST202')return {ok:false,error:'Aplique a migration 0040 para habilitar o teste local.'};
  if(error)return {ok:false,error:/^(Saldo de|Você já|Limite de|Voucher indisponível|A loja está)/.test(error.message)?error.message:'Não foi possível resgatar. Confira seu saldo e tente novamente.'};
  refresh();revalidatePath('/painel','layout');return {ok:true,data:null};
 }catch(error){rethrowIfRedirect(error);return {ok:false,error:'Não foi possível resgatar o voucher.'};}
}
