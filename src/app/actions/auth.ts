"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { customerExistsByPhone } from "@/lib/dal";
import { isShippingComplete } from "@/lib/customers";
import { hashInviteToken } from "@/lib/invites";
import { toE164 } from "@/lib/phone";
import { allow, clientIp } from "@/lib/ratelimit";

const RATE_MSG = "Muitas tentativas. Aguarde alguns minutos e tente de novo.";

/**
 * Mensagem genérica para erro que veio do banco/auth.
 *
 * As server actions de login são públicas: propagar `error.message` expõe
 * estrutura de schema, política de RLS e detalhes internos a qualquer
 * visitante. O detalhe original vai para o log do servidor.
 */
function dbError(scope: string, error: { message: string }): string {
  console.error(`[auth] ${scope}: ${error.message}`);
  return "Não foi possível concluir agora. Tente novamente em instantes.";
}

export type AuthFormState = {
  error?: string;
  notice?: string;
} | undefined;

/* -------------------------------------------------------------------------- */
/*  Admin: e-mail + senha                                                      */
/* -------------------------------------------------------------------------- */

export async function adminSignIn(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Informe e-mail e senha." };
  }

  if (!(await allow("admin-signin", email.toLowerCase(), [await clientIp()]))) {
    return { error: RATE_MSG };
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: "E-mail ou senha inválidos." };
  }

  revalidatePath("/", "layout");
  redirect("/admin");
}

export async function adminSignOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

/* -------------------------------------------------------------------------- */
/*  Cliente: login por senha (celular + senha)                                */
/* -------------------------------------------------------------------------- */

/**
 * Pós-login do cliente: endereço incompleto manda para o cadastro,
 * caso contrário vai direto para o painel.
 */
async function redirectAfterCustomerLogin(
  supabase: Awaited<ReturnType<typeof createClient>>,
  authUserId: string | undefined,
): Promise<never> {
  let nextPath = "/painel";
  if (authUserId) {
    const { data: row } = await supabase
      .from("customers")
      .select(
        "name, email, cpf_cnpj, address_cep, address_street, address_number, address_complement, address_district, address_city, address_state",
      )
      .eq("auth_user_id", authUserId)
      .maybeSingle();

    if (row && !isShippingComplete(row)) nextPath = "/painel/cadastro";
  }

  revalidatePath("/", "layout");
  redirect(nextPath);
}

export async function customerSignIn(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const phone = toE164(String(formData.get("phone") ?? ""));
  const password = String(formData.get("password") ?? "");

  if (!phone) {
    return { error: "Informe um número de WhatsApp válido com DDD." };
  }
  if (!password) {
    return { error: "Informe sua senha." };
  }

  if (!(await allow("customer-signin", phone, [await clientIp()]))) {
    return { error: RATE_MSG };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    phone,
    password,
  });

  if (error) {
    return { error: "Número ou senha incorretos." };
  }

  await redirectAfterCustomerLogin(supabase, data.user?.id);
}

/**
 * Procura o usuário auth por telefone (quando o OTP já havia criado um).
 * O GoTrue grava `auth.users.phone` sem o "+", então comparamos sem sinal.
 */
async function findAuthUserByPhone(
  admin: ReturnType<typeof createAdminClient>,
  phone: string
): Promise<string | null> {
  const wanted = phone.replace("+", "");
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 100,
    });
    if (error || !data) return null;
    const hit = data.users.find((u) => u.phone?.replace("+", "") === wanted);
    if (hit) return hit.id;
    if (data.users.length < 100) return null;
  }
  return null;
}

/**
 * Primeiro acesso via link de convite: valida o token, cria (ou atualiza)
 * a conta auth com o telefone já cadastrado, marca o convite como usado,
 * entra na sessão e manda para o cadastro de dados.
 */
export async function acceptCustomerInvite(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const token = String(formData.get("token") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!token) {
    return { error: "Link de convite inválido. Peça um novo link ao admin." };
  }
  if (password.length < 8) {
    return { error: "A senha precisa de pelo menos 8 caracteres." };
  }
  if (password !== confirm) {
    return { error: "As senhas não conferem." };
  }

  if (!(await allow("invite-accept", await clientIp()))) {
    return { error: RATE_MSG };
  }

  const admin = createAdminClient();

  const { data: invite, error: inviteError } = await admin
    .from("customer_invites")
    .select(
      "id, expires_at, used_at, customer:customers(id, phone_e164, auth_user_id, name, email, cpf_cnpj, address_cep, address_street, address_number, address_complement, address_district, address_city, address_state)",
    )
    .eq("token_hash", hashInviteToken(token))
    .maybeSingle();

  if (inviteError) {
    if (inviteError.message.includes("customer_invites")) {
      return {
        error:
          "Convites indisponíveis: aplique a migração 0007_customer_invites.sql no SQL Editor.",
      };
    }
    return { error: dbError("ler convite", inviteError) };
  }

  const customer = Array.isArray(invite?.customer)
    ? invite.customer[0]
    : invite?.customer;

  if (!invite || !customer) {
    return { error: "Convite inválido. Peça um novo link ao admin." };
  }
  if (invite.used_at) {
    return { error: "Este convite já foi usado. Peça um novo link ao admin." };
  }
  if (new Date(invite.expires_at) < new Date()) {
    return { error: "Este link expirou. Peça um novo link ao admin." };
  }

  // 1) Cria (ou atualiza) a conta auth com o telefone já cadastrado.
  let authUserId: string | null = customer.auth_user_id;

  if (authUserId) {
    const { error } = await admin.auth.admin.updateUserById(authUserId, {
      password,
      phone_confirm: true,
    });
    if (error) {
      return { error: dbError("definir senha", error) };
    }
  } else {
    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        phone: customer.phone_e164,
        password,
        phone_confirm: true,
      });

    if (createError) {
      // Já existe uma conta com este telefone (ex.: OTP interrompido).
      if (!/already|exist/i.test(createError.message)) {
        return { error: dbError("criar acesso", createError) };
      }
      const existingId = await findAuthUserByPhone(admin, customer.phone_e164);
      if (!existingId) {
        return { error: dbError("criar acesso (existente)", createError) };
      }
      const { error: updateError } = await admin.auth.admin.updateUserById(
        existingId,
        { password, phone_confirm: true },
      );
      if (updateError) {
        return { error: dbError("definir senha (existente)", updateError) };
      }
      authUserId = existingId;
    } else {
      authUserId = created.user?.id ?? null;
      if (!authUserId) {
        return { error: "Não foi possível criar o acesso." };
      }
    }
  }

  // 2) Garante o vínculo customers.auth_user_id (o trigger também faz isso).
  if (customer.auth_user_id !== authUserId) {
    const { error: linkError } = await admin
      .from("customers")
      .update({ auth_user_id: authUserId })
      .eq("id", customer.id);
    if (linkError) {
      return { error: dbError("vincular cliente", linkError) };
    }
  }

  // 3) Entra na sessão com celular + senha. Só depois de entrar é que o
  //    convite é consumido — assim um login que falha não queima o link.
  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    phone: customer.phone_e164,
    password,
  });
  if (signInError) {
    return { error: dbError("entrar após convite", signInError) };
  }

  // 4) Marca o convite como usado (update condicional = uso único).
  const { data: consumed } = await admin
    .from("customer_invites")
    .update({ used_at: new Date().toISOString() })
    .eq("id", invite.id)
    .is("used_at", null)
    .select("id")
    .maybeSingle();
  if (!consumed) {
    return { error: "Este convite já foi usado. Peça um novo link ao admin." };
  }

  await redirectAfterCustomerLogin(supabase, authUserId);
}

/* -------------------------------------------------------------------------- */
/*  Cliente: OTP por telefone                                                 */
/* -------------------------------------------------------------------------- */

export async function requestCustomerOtp(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const phone = toE164(String(formData.get("phone") ?? ""));

  if (!phone) {
    return { error: "Informe um número de WhatsApp válido com DDD." };
  }

  const ip = await clientIp();
  if (!(await allow("otp-request", phone, [ip]))) {
    return { error: RATE_MSG };
  }

  if (!(await customerExistsByPhone(phone))) {
    return {
      error: "Não encontramos este número. Peça ao admin para cadastrar você.",
    };
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithOtp({
    phone,
    options: { channel: "whatsapp", shouldCreateUser: true },
  });

  if (error) {
    if (error.message === "Rate limit exceeded") {
      return {
        error: "Muitas tentativas. Aguarde 1 minuto e tente de novo.",
      };
    }
    return { error: dbError("enviar OTP", error) };
  }

  return { notice: "Código enviado no seu WhatsApp." };
}

export async function verifyCustomerOtp(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const phone = toE164(String(formData.get("phone") ?? ""));
  const token = String(formData.get("token") ?? "").replace(/\D/g, "");

  if (!phone) return { error: "Número inválido. Volte e informe de novo." };
  if (token.length !== 6) return { error: "O código tem 6 dígitos." };

  if (!(await allow("otp-verify", phone, [await clientIp()]))) {
    return { error: RATE_MSG };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.auth.verifyOtp({
    phone,
    token,
    type: "sms",
  });

  if (error) {
    return { error: "Código incorreto ou expirado." };
  }

  await redirectAfterCustomerLogin(supabase, data.user?.id);
}

export async function customerSignOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/painel/login");
}

/** Sai de qualquer área sem importar o tipo de conta (tela /sem-acesso). */
export async function endSession(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}
