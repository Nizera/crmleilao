"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { allowPublic } from "@/lib/ratelimit";
import { customerEmailSchema, customerEmailCodeSchema, inviteAcceptSchema } from "@/lib/auth-schemas";
import { toE164 } from "@/lib/phone";
import type { AuthFormState } from "./auth";

export type EmailAccessState = { error?:string; notice?:string; email?:string; sent?:boolean } | undefined;
const notice = "Se for possível continuar com este e-mail, você receberá um código. Confira também o spam. Se não chegar, fale com a equipe.";
const unavailable = "Acesso por e-mail indisponível no momento. Use sua senha ou peça um convite à equipe.";
const conflict = "Não foi possível vincular o cadastro. Fale com a equipe para conferir seu e-mail e WhatsApp. Seus lotes foram preservados.";
function enabled() { return process.env.CUSTOMER_EMAIL_ACCESS_ENABLED?.trim().toLowerCase() === "true"; }

export async function requestCustomerEmail(_previous:EmailAccessState, form:FormData):Promise<EmailAccessState> {
  if (!enabled()) return {error:unavailable};
  const parsed = customerEmailSchema.safeParse(form.get("email"));
  if (!parsed.success) return {error:"Informe um e-mail válido."};
  const email = parsed.data;
  if (!await allowPublic("customer-email-send",email)) return {error:"Aguarde alguns minutos antes de pedir outro código."};
  const result = {sent:true,email,notice};
  const admin = createAdminClient();
  const {data:targets,error} = await admin.rpc("customer_email_access_target",{p_email:email});
  // Falha fechada se a migração ainda não estiver aplicada.
  if (error) { console.error("[email-access] lookup unavailable",error.code); return {error:unavailable}; }
  if (targets?.length > 1) return result;
  const target = targets?.[0];
  let shouldCreateUser = true;
  if (target?.auth_user_id) {
    const {data:account,error:readError} = await admin.auth.admin.getUserById(target.auth_user_id);
    const {data:staff,error:staffError} = await admin.from("admin_profiles").select("id").eq("id",target.auth_user_id).maybeSingle();
    if (readError || staffError || staff || !account.user) return result;
    const currentEmail = account.user.email?.trim().toLowerCase();
    // Nunca substitui outro e-mail de autenticação via formulário público.
    if (currentEmail && currentEmail !== email) return result;
    if (!currentEmail) {
      // Usa SOMENTE o e-mail que já está no cadastro da equipe. Não muda senha,
      // telefone nem confirma o e-mail antes da prova enviada pelo SMTP.
      const {error:attachError} = await admin.auth.admin.updateUserById(target.auth_user_id,{email,email_confirm:false});
      if (attachError) return result;
    }
    shouldCreateUser = false;
  }
  const supabase = await createClient();
  const {error:sendError} = await supabase.auth.signInWithOtp({email,options:{shouldCreateUser}});
  if (sendError) console.error("[email-access] delivery failed",sendError.status,sendError.code);
  return result;
}

export async function verifyCustomerEmail(_previous:EmailAccessState,form:FormData):Promise<EmailAccessState> {
  if (!enabled()) return {error:unavailable};
  const email = customerEmailSchema.safeParse(form.get("email"));
  const token = customerEmailCodeSchema.safeParse(form.get("code"));
  if (!email.success || !token.success) return {error:"Confira seu e-mail e o código recebido."};
  if (!await allowPublic("customer-email-verify",email.data)) return {error:"Muitas tentativas. Aguarde alguns minutos."};
  const supabase = await createClient();
  const {data,error} = await supabase.auth.verifyOtp({email:email.data,token:token.data,type:"email"});
  if (error) return {error:"Código inválido ou expirado. Peça um novo código e use o mais recente."};
  if (!data.user?.email_confirmed_at || data.user.email?.toLowerCase() !== email.data) return {error:unavailable};
  const admin = createAdminClient();
  const {error:proofError} = await admin.from("customer_email_proofs").upsert({
    auth_user_id:data.user.id,email:email.data,verified_at:new Date().toISOString(),
  });
  if (proofError) return {error:unavailable};
  redirect("/painel/ativar");
}

export async function finishCustomerEmail(_previous:AuthFormState,form:FormData):Promise<AuthFormState> {
  if (!enabled()) return {error:unavailable};
  const parsed = inviteAcceptSchema.safeParse({token:"email-verified",password:form.get("password"),confirm:form.get("confirm")});
  if (!parsed.success) return {error:parsed.error.issues[0]?.message ?? "Confira a senha."};
  const supabase = await createClient();
  const {data:{user},error:userError} = await supabase.auth.getUser();
  const {data:claims,error:claimsError} = await supabase.auth.getClaims();
  const methods = claims?.claims.amr as {method:string;timestamp:number}[] | undefined;
  const freshOtp = methods?.some(item=>item.method === "otp" && item.timestamp > Date.now()/1000-900);
  if (userError || claimsError || !user?.email_confirmed_at || !freshOtp) return {error:"Confirme novamente o código por e-mail antes de definir a senha."};
  if (!await allowPublic("customer-email-finish",user.id)) return {error:"Muitas tentativas. Aguarde alguns minutos."};
  const name = String(form.get("name") ?? "").trim();
  const phone = toE164(String(form.get("phone") ?? ""));
  const {error:linkError} = await supabase.rpc("complete_customer_email_access",{p_name:name,p_phone:phone ?? ""});
  if (linkError) {
    console.error("[email-access] profile not linked",linkError.code);
    return {error:linkError.message === "INVALID_PROFILE" ? "Para uma conta nova, informe seu nome completo e WhatsApp com DDD." : conflict};
  }
  const {error:passwordError} = await supabase.auth.updateUser({password:parsed.data.password});
  if (passwordError) return {error:"Cadastro vinculado, mas não foi possível definir a senha. Confira os requisitos e tente novamente."};
  revalidatePath("/", "layout");
  redirect("/painel");
}
