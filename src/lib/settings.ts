import { z } from "zod";

/**
 * Parâmetros globais gravados em `public.app_settings` (linha única).
 * Os defaults são idênticos aos da migração 0004_settings.sql.
 */
export type AppSettings = {
  bid_increment: number;
  shipping_weekday: number;
  wa_notice_template: string;
  wa_payment_template: string;
  wa_shipping_template: string;
  /** Endereço de origem dos envios SuperFrete (F4). */
  origin_name: string;
  origin_address: string;
  origin_number: string;
  origin_district: string;
  origin_city: string;
  origin_state: string;
  origin_cep: string;
};

export const DEFAULT_SETTINGS: AppSettings = {
  bid_increment: 5,
  shipping_weekday: 2,
  wa_notice_template: [
    "Lote {code} — {title}",
    "Arremate: {value}",
    "Envio: {shipping}",
    "",
    "Acompanhe no seu painel: {link}",
  ].join("\n"),
  wa_payment_template: [
    "Olá {name}! O lote {code} está aguardando pagamento.",
    "Valor: {value}",
    "Pague pelo Pix: {link}",
  ].join("\n"),
  wa_shipping_template: [
    "Olá {name}! O lote {code} foi enviado.",
    "Rastreio: {tracking}",
  ].join("\n"),
  origin_name: "",
  origin_address: "",
  origin_number: "",
  origin_district: "",
  origin_city: "",
  origin_state: "",
  origin_cep: "",
};

/** Índice do dia da semana em `Date.getUTCDay()`: 0 = domingo … 6 = sábado. */
export const WEEKDAY_LABELS = [
  "domingo",
  "segunda",
  "terça",
  "quarta",
  "quinta",
  "sexta",
  "sábado",
] as const;

export const WEEKDAY_LABELS_FULL = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
] as const;

export type TemplateKey =
  | "wa_notice_template"
  | "wa_payment_template"
  | "wa_shipping_template";

export const MESSAGE_TEMPLATES: {
  key: TemplateKey;
  title: string;
  description: string;
  placeholders: string[];
}[] = [
  {
    key: "wa_notice_template",
    title: "Aviso de arremate",
    description: "Mensagem aberta pelo botão “Enviar no WhatsApp” em Lotes.",
    placeholders: ["code", "title", "value", "shipping", "link"],
  },
  {
    key: "wa_payment_template",
    title: "Pedido de pagamento",
    description: "Enviado junto com o QR/link do Pix da cobrança (Mercado Pago).",
    placeholders: ["name", "code", "value", "link"],
  },
  {
    key: "wa_shipping_template",
    title: "Aviso de envio",
    description: "Enviado quando o pacote é postado, com o código de rastreio.",
    placeholders: ["name", "code", "tracking"],
  },
];

/** Dados fictícios usados na prévia dos modelos. */
export const TEMPLATE_SAMPLE_VARS: Record<string, string> = {
  code: "A1B2C3D4",
  title: "Figura especial — seleção França",
  value: "R$ 45,00",
  shipping: "13/10/2026",
  link: "https://seusite.com/painel/lotes/A1B2C3D4",
  name: "João",
  tracking: "BR123456789LP",
};

/** Substitui `{chave}` pelos valores informados; chaves desconhecidas ficam. */
export function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match);
}

export const settingsFormSchema = z.object({
  bid_increment: z
    .string()
    .trim()
    .regex(/^\d{1,4}([.,]\d{1,2})?$/, "Use algo como 5 ou 5,50"),
  shipping_weekday: z
    .string()
    .trim()
    .regex(/^[0-6]$/, "Dia da semana inválido"),
  wa_notice_template: z
    .string()
    .trim()
    .min(1, "O modelo de arremate não pode ficar vazio")
    .max(3000, "Modelo muito longo"),
  wa_payment_template: z
    .string()
    .trim()
    .min(1, "O modelo de pagamento não pode ficar vazio")
    .max(3000, "Modelo muito longo"),
  wa_shipping_template: z
    .string()
    .trim()
    .min(1, "O modelo de envio não pode ficar vazio")
    .max(3000, "Modelo muito longo"),
  origin_name: z.string().trim().max(50, "Máximo de 50 caracteres"),
  origin_address: z.string().trim().max(50, "Máximo de 50 caracteres"),
  origin_number: z.string().trim().max(10, "Máximo de 10 caracteres"),
  origin_district: z.string().trim().max(60, "Máximo de 60 caracteres"),
  origin_city: z.string().trim().max(50, "Máximo de 50 caracteres"),
  origin_state: z
    .string()
    .trim()
    .regex(/^$|^[A-Z]{2}$/, "Use 2 letras maiúsculas (SP)"),
  origin_cep: z
    .string()
    .trim()
    .regex(/^$|^\d{8}$/, "CEP com 8 dígitos, só números"),
});

export type SettingsFormValues = z.input<typeof settingsFormSchema>;

/** Origem completa o bastante para emitir etiqueta SuperFrete (F4). */
export function isOriginComplete(settings: AppSettings): boolean {
  return Boolean(
    settings.origin_name &&
      settings.origin_address &&
      settings.origin_district &&
      settings.origin_city &&
      settings.origin_state &&
      settings.origin_cep,
  );
}
