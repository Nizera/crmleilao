"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { customerExistsByPhone } from "@/lib/dal";
import { isShippingComplete } from "@/lib/customers";
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

  // Primeiro login: pede o endereço completo antes de liberar o painel.
  let nextPath = "/painel";
  const authUserId = data.user?.id;
  if (authUserId) {
    const { data: row } = await supabase
      .from("customers")
      .select(
        "name, email, address_cep, address_street, address_number, address_complement, address_district, address_city, address_state",
      )
      .eq("auth_user_id", authUserId)
      .maybeSingle();

    if (row && !isShippingComplete(row)) nextPath = "/painel/cadastro";
  }

  revalidatePath("/", "layout");
  redirect(nextPath);
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
