import "server-only";

import { siteUrl } from "@/lib/lots";

/**
 * Cliente HTTP do Mercado Pago — API de pagamentos (Pix).
 * Sem SDK: só `fetch` para `https://api.mercadopago.com/v1/payments`.
 * Credenciais viram de `MP_ACCESS_TOKEN` (painel > Suas integrações).
 */

const MP_API = "https://api.mercadopago.com";
const PIX_EXPIRES_DAYS = 3;

export function mpAccessToken(): string {
  const token = process.env.MP_ACCESS_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "Mercado Pago não configurado: defina MP_ACCESS_TOKEN no .env e reinicie o servidor.",
    );
  }
  return token;
}

/** Só para a tela de Configuração (nunca expõe o valor). */
export function mpConfigured(): boolean {
  return Boolean(process.env.MP_ACCESS_TOKEN?.trim());
}

/** Há segredo de path do webhook? Sem isso, a confirmação fica manual. */
export function mpWebhookConfigured(): boolean {
  return Boolean(process.env.MP_WEBHOOK_TOKEN?.trim());
}

/** Segredo do path do webhook. Sem ele, a confirmação fica manual. */
export function mpWebhookUrl(): string | null {
  const pathSecret = process.env.MP_WEBHOOK_TOKEN?.trim();
  if (!pathSecret) return null;
  return `${siteUrl()}/api/webhooks/mercadopago/${pathSecret}`;
}

/**
 * ISO 8601 com offset de Brasília (America/Sao_Paulo é -03:00 sem DST).
 * O MP aceita `2026-10-11T12:00:00.000-03:00` em `date_of_expiration`.
 */
function expiryIso(days: number): string {
  return new Date(Date.now() + days * 86_400_000)
    .toISOString()
    .replace("Z", "-03:00");
}

async function mpFetch(
  path: string,
  options?: { method?: "GET" | "POST"; body?: unknown; idempotencyKey?: string },
): Promise<unknown> {
  const response = await fetch(`${MP_API}${path}`, {
    method: options?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${mpAccessToken()}`,
      "Content-Type": "application/json",
      ...(options?.idempotencyKey
        ? { "X-Idempotency-Key": options.idempotencyKey }
        : {}),
    },
    ...(options?.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    cache: "no-store",
  });

  const json: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const detail =
      json && typeof json === "object" && "message" in json
        ? String((json as { message: unknown }).message)
        : `HTTP ${response.status}`;
    throw new Error(`Mercado Pago: ${detail}`);
  }

  return json;
}

export type MpPixPayment = {
  paymentId: string;
  status: string;
  /** Pix copia e cola (BR Code). */
  qrCode: string | null;
  /** PNG do QR em base64 puro (sem prefixo data:). */
  qrCodeBase64: string | null;
  /** Página de pagamento do MP (fallback quando não há QR). */
  ticketUrl: string | null;
  amount: number;
  dateOfExpiration: string | null;
};

type MpPixResponse = {
  id?: number | string;
  status?: string;
  date_of_expiration?: string | null;
  transaction_amount?: number;
  point_of_interaction?: {
    transaction_data?: {
      qr_code?: string;
      qr_code_base64?: string;
      ticket_url?: string;
    };
  };
};

/** Cria um Pix no Mercado Pago e devolve o QR + copia e cola. */
export async function createPixPayment(input: {
  amount: number;
  description: string;
  externalReference: string;
  payerEmail: string;
  payerFirstName?: string;
  payerLastName?: string;
  identification?: { type: "CPF" | "CNPJ"; number: string };
}): Promise<MpPixPayment> {
  const webhookUrl = mpWebhookUrl();

  const json = (await mpFetch("/v1/payments", {
    method: "POST",
    idempotencyKey: input.externalReference,
    body: {
      transaction_amount: input.amount,
      description: input.description.slice(0, 250),
      external_reference: input.externalReference,
      payment_method_id: "pix",
      date_of_expiration: expiryIso(PIX_EXPIRES_DAYS),
      ...(webhookUrl ? { notification_url: webhookUrl } : {}),
      payer: {
        email: input.payerEmail,
        ...(input.payerFirstName ? { first_name: input.payerFirstName } : {}),
        ...(input.payerLastName ? { last_name: input.payerLastName } : {}),
        ...(input.identification
          ? {
              identification: {
                type: input.identification.type,
                number: input.identification.number,
              },
            }
          : {}),
      },
    },
  })) as MpPixResponse;

  const data = json.point_of_interaction?.transaction_data;

  return {
    paymentId: String(json.id ?? ""),
    status: json.status ?? "pending",
    qrCode: data?.qr_code ?? null,
    qrCodeBase64: data?.qr_code_base64 ?? null,
    ticketUrl: data?.ticket_url ?? null,
    amount: Number(json.transaction_amount ?? input.amount),
    dateOfExpiration: json.date_of_expiration ?? null,
  };
}

export type MpPayment = {
  id: string;
  status: string;
  statusDetail: string;
  amount: number;
  externalReference: string | null;
  dateApproved: string | null;
};

type MpGetResponse = {
  id?: number | string;
  status?: string;
  status_detail?: string;
  transaction_amount?: number;
  external_reference?: string | null;
  date_approved?: string | null;
};

/**
 * Consulta um pagamento pelo id.
 * - null  = id inexistente/inválido (404/400 na API) — notificação falsa ou
 *           antiga; o chamador pode ignorar sem ficar reprocessando.
 * - lança erro em falha transitória (rede/5xx) — o webhook responde 500 e o
 *   Mercado Pago reenvia a notificação.
 */
export async function getPayment(paymentId: string): Promise<MpPayment | null> {
  if (!/^\d+$/.test(paymentId)) return null;

  const response = await fetch(`${MP_API}/v1/payments/${paymentId}`, {
    headers: {
      Authorization: `Bearer ${mpAccessToken()}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (response.status === 404 || response.status === 400) return null;
  if (!response.ok) {
    throw new Error(`Mercado Pago: HTTP ${response.status} ao consultar pagamento`);
  }

  const json = (await response.json()) as MpGetResponse;
  if (!json.id) return null;

  return {
    id: String(json.id),
    status: json.status ?? "",
    statusDetail: json.status_detail ?? "",
    amount: Number(json.transaction_amount ?? 0),
    externalReference: json.external_reference ?? null,
    dateApproved: json.date_approved ?? null,
  };
}
