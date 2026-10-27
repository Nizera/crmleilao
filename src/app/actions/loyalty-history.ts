"use server";
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireAdmin,requireCustomer } from '@/lib/dal';
import { createClient } from '@/lib/supabase/server';
import { rethrowIfRedirect,type ActionResult } from '@/lib/result';
import { allow } from '@/lib/ratelimit';
import type { StoreProduct } from '@/lib/store';
export type AdjustmentCustomer={id:string;name:string|null;phone_e164:string;balance:number};
export async function searchAdjustmentCustomers(query:string):Promise<ActionResult<AdjustmentCustomer[]>>{
 try{const {profile}=await requireAdmin();if(typeof query!=='string'||query.trim().length<2)return {ok:true,data:[]};
 if(!await allow('loyalty-read',profile.id))return {ok:false,error:'Aguarde antes de buscar novamente.'};
 const db=await createClient();const {data,error}=await db.rpc('search_loyalty_customers',{p_query:query.trim().slice(0,100)});
 if(error)return {ok:false,error:'Não foi possível buscar clientes.'};return {ok:true,data:data??[]};
 }catch(e){rethrowIfRedirect(e);return {ok:false,error:'Não foi possível buscar clientes.'};}
}
const adjustmentSchema=z.object({request:z.uuid(),customer:z.uuid(),points:z.number().finite().min(-1000000).max(1000000).refine(n=>n!==0&&Math.abs(n*100-Math.round(n*100))<1e-6),note:z.string().trim().min(4).max(500)});
export async function confirmCaracoinsAdjustment(input:unknown):Promise<ActionResult>{
 try{const {profile}=await requireAdmin();if(profile.role==='viewer')return {ok:false,error:'Perfil somente leitura.'};
 const parsed=adjustmentSchema.safeParse(input);if(!parsed.success)return {ok:false,error:'Revise o cliente, o valor e o motivo do ajuste.'};
 if(!await allow('store-catalog-write',profile.id))return {ok:false,error:'Aguarde antes de lançar outro ajuste.'};
 const db=await createClient();const {error}=await db.rpc('adjust_caracoins_once',{p_request:parsed.data.request,p_customer:parsed.data.customer,p_points:parsed.data.points,p_note:parsed.data.note});
 if(error)return {ok:false,error:'Não foi possível registrar. Confira o extrato antes de repetir; mantenha esta confirmação para tentar novamente.'};
 revalidatePath('/admin/fidelidade/extrato');revalidatePath('/admin/fidelidade');revalidatePath('/painel','layout');return {ok:true,data:null};
 }catch(e){rethrowIfRedirect(e);return {ok:false,error:'Não foi possível registrar agora. Tente novamente nesta mesma confirmação.'};}
}
export async function getCartProducts(ids:unknown):Promise<ActionResult<StoreProduct[]>>{
 try{const {customer}=await requireCustomer();const parsed=z.array(z.uuid()).max(50).safeParse(ids);if(!parsed.success)return {ok:false,error:'Carrinho inválido.'};
 if(!parsed.data.length)return {ok:true,data:[]};
 if(!await allow('loyalty-read',customer.id))return {ok:false,error:'Aguarde antes de consultar o carrinho.'};
 const db=await createClient();const {data,error}=await db.from('loyalty_rewards').select('id,name,description,image_path,image_paths,stock,points_cost,cash_price,mixed_cash_price,mixed_points_cost,sku,category,delivery_kind').in('id',parsed.data).eq('active',true).eq('archived',false);
 if(error)return {ok:false,error:'Não foi possível atualizar os produtos do carrinho.'};return {ok:true,data:data??[]};
 }catch(e){rethrowIfRedirect(e);return {ok:false,error:'Não foi possível atualizar o carrinho.'};}
}
