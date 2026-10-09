import { z } from "zod";

import { toE164 } from "@/lib/phone";

/** Forma canônica do telefone guardada em `customers.phone_e164`. */
export const e164Pattern = /^\+\d{12,13}$/;

export const phoneField = z
  .string()
  .trim()
  .min(1, "Informe o WhatsApp do cliente")
  .refine(
    (value) => toE164(value) !== null,
    "WhatsApp inválido: use DDD + número (ex.: 11 99999-8888)",
  );

const emailField = z
  .string()
  .trim()
  .max(200, "E-mail muito longo")
  .refine(
    (value) => value === "" || /^\S+@\S+\.\S+$/.test(value),
    "E-mail inválido",
  );

export const customerFormSchema = z.object({
  id: z.string().trim().optional(),
  name: z
    .string()
    .trim()
    .min(2, "Nome precisa de pelo menos 2 caracteres")
    .max(120, "Nome muito longo"),
  phone: phoneField,
  email: emailField.optional(),
  cpf_cnpj: z
    .string()
    .trim()
    .max(20, "CPF/CNPJ muito longo")
    .optional(),
  notes: z
    .string()
    .trim()
    .max(1000, "Observações muito longas")
    .optional(),
});

export type CustomerFormValues = z.infer<typeof customerFormSchema>;

/** Formulário de endereço do cliente (primeiro login e "Meus dados"). */
export const shippingFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Informe seu nome completo")
    .max(120, "Nome muito longo"),
  email: z
    .string()
    .trim()
    .min(1, "Informe o e-mail — ele é usado para gerar o Pix")
    .max(200, "E-mail muito longo")
    .refine(
      (value) => /^\S+@\S+\.\S+$/.test(value),
      "E-mail inválido",
    ),
  address_cep: z
    .string()
    .trim()
    .regex(/^\d{5}-?\d{3}$/, "CEP inválido: use 8 dígitos"),
  address_street: z
    .string()
    .trim()
    .min(3, "Informe a rua")
    .max(160, "Rua muito longa"),
  address_number: z
    .string()
    .trim()
    .min(1, "Informe o número")
    .max(20, "Número muito longo"),
  address_complement: z
    .string()
    .trim()
    .max(80, "Complemento muito longo")
    .optional()
    .or(z.literal("")),
  address_district: z
    .string()
    .trim()
    .min(2, "Informe o bairro")
    .max(80, "Bairro muito longo"),
  address_city: z
    .string()
    .trim()
    .min(2, "Informe a cidade")
    .max(80, "Cidade muito longa"),
  address_state: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, "UF inválida (2 letras)"),
});

export type ShippingFormValues = z.input<typeof shippingFormSchema>;

/** Colunas de endereço como retornadas pelo banco (`customers`). */
export type ShippingProfile = {
  name: string | null;
  email: string | null;
  address_cep: string | null;
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  address_district: string | null;
  address_city: string | null;
  address_state: string | null;
};

/** Endereço completo? Decide se o primeiro login ainda precisa pedir dados. */
export function isShippingComplete(
  profile: ShippingProfile | null | undefined,
): boolean {
  if (!profile) return false;
  const required = [
    profile.name,
    profile.email,
    profile.address_cep,
    profile.address_street,
    profile.address_number,
    profile.address_district,
    profile.address_city,
    profile.address_state,
  ];
  return required.every(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
}

export const BRAZIL_UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS",
  "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC",
  "SP", "SE", "TO",
] as const;

/** "5511999998888" -> "+5511999998888"; "11 99999-8888" -> "+5511999998888". */
export const normalizePhone = (raw: string): string | null => toE164(raw);

export const formatPhoneBR = (e164: string): string => {
  const digits = e164.replace(/\D/g, "").replace(/^55/, "");
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return e164;
};
