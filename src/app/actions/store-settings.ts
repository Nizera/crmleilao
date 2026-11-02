'use server';
import {revalidatePath} from 'next/cache';
import {requireAdmin} from '@/lib/dal';
import {createClient} from '@/lib/supabase/server';
import {allow} from '@/lib/ratelimit';
import {rethrowIfRedirect,type ActionResult} from '@/lib/result';

export async function saveStoreCommerce(form:FormData):Promise<ActionResult>{
 try{
  const {profile}=await requireAdmin();if(profile.role!=='owner')return {ok:false,error:'Somente o dono pode abrir ou fechar as compras.'};
  if(!await allow('store-catalog-write',profile.id))return {ok:false,error:'Aguarde antes de tentar novamente.'};
  const enabled=form.get('enabled')==='on';const note=String(form.get('note')??'').trim();
  if(note.length<5||note.length>500)return {ok:false,error:'Informe o motivo da mudança (5 a 500 caracteres).'};
  const db=await createClient();
  if(enabled){
   const {data,error}=await db.from('loyalty_rewards').select('cash_price,delivery_kind').eq('active',true).eq('archived',false);
   if(error)return {ok:false,error:'Não foi possível conferir os produtos.'};
   if(data.some(p=>Number(p.cash_price)>0||p.delivery_kind==='physical')){
    const missing=['MP_ACCESS_TOKEN','MP_WEBHOOK_SECRET','MP_WEBHOOK_TOKEN','CRON_SECRET',...(data.some(p=>p.delivery_kind==='physical')?['SUPERFRETE_TOKEN']:[])].filter(key=>!process.env[key]?.trim());
    if(missing.length)return {ok:false,error:`Configure no servidor antes de abrir: ${missing.join(', ')}.`};
   }
  }
  const {error}=await db.rpc('set_store_commerce_enabled',{p_enabled:enabled,p_note:note});
  if(error)return {ok:false,error:/^(Ative|Revise|Cadastre|Informe)/.test(error.message)?error.message:'Não foi possível alterar. Confira a migration 0039.'};
  revalidatePath('/admin/fidelidade/configuracao');revalidatePath('/painel/loja');return {ok:true,data:null};
 }catch(error){rethrowIfRedirect(error);return {ok:false,error:'Não foi possível alterar o funcionamento da loja.'};}
}
