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

/** Cliente: WhatsApp + senha (`customerSignIn`). Normaliza para E.164. */
export const customerLoginSchema = z.object({
  phone: z.string().trim().transform((value, ctx) => {
    const e164 = toE164(value);
    if (!e164) {
      ctx.addIssue({
        code: "custom",
        message: "Informe um número de WhatsApp válido com DDD.",
      });
      return z.NEVER;
    }
    return e164;
  }),
  password: z
    .string()
    .min(1, "Informe sua senha.")
    .max(PASSWORD_MAX, "Senha longa demais."),
});

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
