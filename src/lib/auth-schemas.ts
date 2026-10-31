import { z } from "zod";

import { toE164 } from "@/lib/phone";

const PASSWORD_MAX = 256;

/** Admin: e-mail + senha (`adminSignIn`). */
export const adminLoginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Informe e-mail e senha.")
    .max(254, "Informe um e-mail válido.")
    .email("Informe um e-mail válido."),
  password: z
    .string()
    .min(1, "Informe e-mail e senha.")
    .max(PASSWORD_MAX, "Senha longa demais."),
});

/** E-mail ou WhatsApp; mantém o nome phone para compatibilidade com formulários antigos. */
export const customerLoginSchema = z.object({
  phone: z.string().trim().max(254).transform((value, ctx) => {
    if (value.includes("@")) {
      const email = z.string().email().safeParse(value.toLowerCase());
      if (email.success) return email.data;
    } else {
      const phone = toE164(value);
      if (phone) return phone;
    }
    ctx.addIssue({code:"custom",message:"Informe seu e-mail ou WhatsApp com DDD."});
    return z.NEVER;
  }),
  password: z.string().min(1,"Informe sua senha.").max(PASSWORD_MAX,"Senha longa demais."),
});

export const customerEmailSchema = z.string().trim().toLowerCase().max(200).email("Informe um e-mail válido.");
export const customerEmailCodeSchema = z.string().trim().regex(/^\d{6,10}$/, "Confira o código recebido por e-mail.");

/** Primeiro acesso pelo link de convite (`acceptCustomerInvite`). */
export const inviteAcceptSchema = z
  .object({
    token: z
      .string()
      .trim()
      .min(1, "Link de convite inválido. Peça um novo link ao admin.")
      .max(256, "Link de convite inválido. Peça um novo link ao admin."),
    password: z
      .string()
      .min(8, "A senha precisa de pelo menos 8 caracteres.")
      .max(PASSWORD_MAX, "A senha pode ter no máximo 256 caracteres."),
    confirm: z.string().max(PASSWORD_MAX, "A senha pode ter no máximo 256 caracteres."),
  })
  .superRefine((value, ctx) => {
    if (value.password !== value.confirm) {
      ctx.addIssue({
        code: "custom",
        path: ["confirm"],
        message: "As senhas não conferem.",
      });
    }
  });
