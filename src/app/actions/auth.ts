"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { customerExistsByPhone } from "@/lib/dal";
import { isShippingComplete } from "@/lib/customers";
import { hashInviteToken } from "@/lib/invites";
import { toE164 } from "@/lib/phone";

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

/** Procura o usuário auth por telefone (quando o OTP já havia criado um). */
async function findAuthUserByPhone(
  admin: ReturnType<typeof createAdminClient>,
  phone: string
): Promise<string | null> {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 100,
    });
    if (error || !data) return null;
    const hit = data.users.find((u) => u.phone === phone);
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
    return { error: `Falha ao ler o convite: ${inviteError.message}` };
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
      return { error: `Não foi possível definir a senha: ${error.message}` };
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
        return { error: `Não foi possível criar o acesso: ${createError.message}` };
      }
      const existingId = await findAuthUserByPhone(admin, customer.phone_e164);
      if (!existingId) {
        return { error: `Não foi possível criar o acesso: ${createError.message}` };
      }
      const { error: updateError } = await admin.auth.admin.updateUserById(
        existingId,
        { password, phone_confirm: true },
      );
      if (updateError) {
        return { error: `Não foi possível definir a senha: ${updateError.message}` };
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
      return { error: `Falha ao vincular o cliente: ${linkError.message}` };
    }
  }

  // 3) Marca o convite como usado (update condicional = uso único).
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

  // 4) Entra na sessão com celular + senha e segue para o próximo passo.
  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    phone: customer.phone_e164,
    password,
  });
  if (signInError) {
    return { error: `Não foi possível entrar: ${signInError.message}` };
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
    return {
      error:
        error.message === "Rate limit exceeded"
          ? "Muitas tentativas. Aguarde 1 minuto e tente de novo."
          : `Não foi possível enviar o código: ${error.message}`,
    };
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
