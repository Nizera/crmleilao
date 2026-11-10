"use server";
import {revalidatePath} from "next/cache";
import {z} from "zod";
import {requireAdmin} from "@/lib/dal";
import {createClient} from "@/lib/supabase/server";
import {rethrowIfRedirect, type ActionResult} from "@/lib/result";

export async function manageCustomerAccess(input: {customer:string;request:string;action:"warning"|"unblock";reason:string}):Promise<ActionResult> {
 try {
  const {profile}=await requireAdmin();
  if(!["owner","staff"].includes(profile.role))return {ok:false,error:"Seu perfil é somente leitura."};
  const parsed=z.object({customer:z.uuid(),request:z.uuid(),action:z.enum(["warning","unblock"]),reason:z.string().trim().min(3).max(500)}).safeParse(input);
  if(!parsed.success)return {ok:false,error:"Informe um motivo com 3 a 500 caracteres."};
  const db=await createClient();
  const v=parsed.data;
  const {error}=await db.rpc("manage_customer_access",{p_customer:v.customer,p_request:v.request,p_action:v.action,p_reason:v.reason});
  if(error){console.error("[customer-access] operação recusada:",error.code);return {ok:false,error:"Não foi possível atualizar o acesso. Atualize a tela e confira se a migration 0074 foi aplicada."};}
  revalidatePath("/admin/clientes");revalidatePath(`/admin/clientes/${v.customer}`);revalidatePath("/painel","layout");
  return {ok:true,data:null};
 }catch(error){rethrowIfRedirect(error);return {ok:false,error:"Não foi possível atualizar o acesso do cliente."};}
}
