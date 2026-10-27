import "server-only";

import { siteUrl } from "@/lib/lots";

/**
 * Cliente HTTP do Mercado Pago — Orders API (Pix).
 * Sem SDK: só `fetch` para `https://api.mercadopago.com/v1/orders`.
 * Credenciais viram de `MP_ACCESS_TOKEN` (painel > Suas integrações).
 *
 * A Orders API substituiu a Payments API (legacy, em descontinuação):
 *  - criação: POST /v1/orders (valor dentro de transactions.payments[]);
 *  - consulta: GET /v1/orders/{id} (id alfanumérico com prefixo ORD);
 *  - notificação: tópico `order`, cadastrada NO PAINEL — o body da requisição
 *    não aceita mais `notification_url`.
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

/**
 * Há segredo da assinatura `x-signature`? Sem isso o endpoint continua
 * aceitando notificação (fail-open de propósito, com warn no log) — a defesa
 * passa a ser só o token de path + reconsulta da order na API.
 */
export function mpSignatureConfigured(): boolean {
  return Boolean(process.env.MP_WEBHOOK_SECRET?.trim());
}

/**
 * URL do webhook para cadastrar em Suas integrações → Webhooks (evento
 * Order) do painel do Mercado Pago. Com a Orders API essa URL não é mais
 * enviada na requisição — o cadastro é manual, uma única vez.
 */
export function mpWebhookUrl(): string | null {
  const pathSecret = process.env.MP_WEBHOOK_TOKEN?.trim();
  if (!pathSecret) return null;
  return `${siteUrl()}/api/webhooks/mercadopago/${pathSecret}`;
}

/**
 * Vencimento local do Pix (mesmo intervalo enviado em `expiration_time: P3D`).
 * Usado como fallback quando a resposta de criação não traz a data.
 * UTC; a conversão de fuso pertence apenas à apresentação.
 */
function expiryIso(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

async function mpFetch(
  path: string,
  options?: { method?: "GET" | "POST"; body?: unknown; idempotencyKey?: string; signal?: AbortSignal },
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
    signal: options?.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
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

export type MpPixOrder = {
  orderId: string;
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

type MpOrderPayment = {
  id?: string;
  status?: string;
  status_detail?: string;
  amount?: string;
  date_of_expiration?: string | null;
  payment_method?: {
    id?: string;
    type?: string;
    qr_code?: string;
    qr_code_base64?: string;
    ticket_url?: string;
  };
};

type MpOrderResponse = {
  id?: string;
  status?: string;
  status_detail?: string;
  total_amount?: string;
  external_reference?: string | null;
  date_of_expiration?: string | null;
  transactions?: { payments?: MpOrderPayment[] };
};

function firstPayment(json: MpOrderResponse | null): MpOrderPayment | null {
  return json?.transactions?.payments?.[0] ?? null;
}

export function qrFrom(json: MpOrderResponse | null): {
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
} {
  const pm = firstPayment(json)?.payment_method;
  return {
    qrCode: pm?.qr_code ?? null,
    qrCodeBase64: pm?.qr_code_base64 ?? null,
    ticketUrl: pm?.ticket_url ?? null,
  };
}

/**
 * Cria uma order Pix no Mercado Pago e devolve o QR + copia e cola.
 * A criação pode ser assíncrona (order "processing" sem QR): nesse caso
 * reconsulta GET /v1/orders/{id} algumas vezes até o QR aparecer.
 */
export async function createPixOrder(input: {
  amount: number;
  description: string;
  externalReference: string;
  payerEmail: string;
  payerFirstName?: string;
  payerLastName?: string;
  identification?: { type: "CPF" | "CNPJ"; number: string };
}, options: { waitForQr?: boolean; signal?: AbortSignal } = {}): Promise<MpPixOrder> {
  const signal = options.signal ?? AbortSignal.timeout(25000);
  const amount = input.amount.toFixed(2);
  const localExpiry = expiryIso(PIX_EXPIRES_DAYS);

  const json = (await mpFetch("/v1/orders", {
    method: "POST",
    idempotencyKey: input.externalReference,
    signal,
    body: {
      type: "online",
      total_amount: amount,
      description: input.description.slice(0, 250),
      external_reference: input.externalReference,
      processing_mode: "automatic",
      transactions: {
        payments: [
          {
            amount,
            payment_method: { id: "pix", type: "bank_transfer" },
            expiration_time: `P${PIX_EXPIRES_DAYS}D`,
          },
        ],
      },
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
  })) as MpOrderResponse;

  let order = json;
  let qr = qrFrom(order);

  if (!order.id) {
    throw new Error("Mercado Pago: order criada sem id.");
  }
  const orderId: string = order.id;

  // Criação assíncrona: a order volta "processing" e o QR chega em seguida.
  for (let attempt = 0; options.waitForQr !== false && !(qr.qrCode || qr.ticketUrl) && attempt < 4; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    const refreshed = await getOrder(orderId, signal);
    if (refreshed) {
      order = refreshed.raw;
      qr = qrFrom(order);
    }
  }

  if (options.waitForQr !== false && !qr.qrCode && !qr.ticketUrl) {
    throw new Error(
      "Mercado Pago: a order foi criada, mas o QR do Pix não ficou disponível. Tente gerar a cobrança novamente.",
    );
  }

  const payment = firstPayment(order);

  return {
    orderId,
    status: order.status ?? payment?.status ?? "action_required",
    ...qr,
    amount: Number(order.total_amount ?? payment?.amount ?? input.amount),
    dateOfExpiration:
      payment?.date_of_expiration ?? order.date_of_expiration ?? localExpiry,
  };
}

export type MpOrder = {
  id: string;
  status: string;
  statusDetail: string;
  amount: number;
  externalReference: string | null;
  dateApproved: string | null;
  /** Bruto da API — usado internamente para reler o QR. */
  raw: MpOrderResponse;
};

/**
 * Consulta uma order pelo id (ORD…).
 * - null  = id inexistente/inválido (404/400 na API) — notificação falsa ou
 *           antiga; o chamador pode ignorar sem ficar reprocessando.
 * - lança erro em falha transitória (rede/5xx) — o webhook responde 500 e o
 *   Mercado Pago reenvia a notificação.
 */
export async function getOrder(orderId: string, signal?: AbortSignal): Promise<MpOrder | null> {
  // Ids de order da Orders API são alfanuméricos iniciando por letra (ORD…);
  // ids numéricos puros são da Payments API legada e não resolvem aqui.
  if (!/^[A-Za-z][A-Za-z0-9_-]{3,}$/.test(orderId)) return null;

  const response = await fetch(`${MP_API}/v1/orders/${orderId}`, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    headers: {
      Authorization: `Bearer ${mpAccessToken()}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (response.status === 404 || response.status === 400) return null;
  if (!response.ok) {
    throw new Error(`Mercado Pago: HTTP ${response.status} ao consultar order`);
  }

  const json = (await response.json()) as MpOrderResponse;
  if (!json.id) return null;

  const payment = firstPayment(json);

  return {
    id: json.id,
    status: json.status ?? payment?.status ?? "",
    statusDetail: json.status_detail ?? payment?.status_detail ?? "",
    amount: Number(json.total_amount ?? payment?.amount ?? 0),
    externalReference: json.external_reference ?? null,
    dateApproved: (json as { date_approved?: string | null }).date_approved ?? null,
    raw: json,
  };
}

/**
 * Cancela no Mercado Pago uma order que acabou de ser criada mas que não
 * pôde ser salva localmente. Sem isso, a ordem viveria no MP sem cobrança
 * correspondente aqui e um pagamento nela não teria onde cair.
 *
 * Devolve `true` quando é seguro desfazer tudo localmente:
 * - 404 = a order não foi localizada;
 * - 200 com status `canceled` = cancelada de fato.
 *
 * Qualquer outra resposta (rede, 4xx/5xx) devolve `false` e o chamador
 * mantém a cobrança local em vez de apagá-la.
 */
export async function cancelPixOrder(orderId: string): Promise<boolean> {
  if (!/^[A-Za-z][A-Za-z0-9_-]{3,}$/.test(orderId)) return false;

  try {
    const response = await fetch(`${MP_API}/v1/orders/${orderId}/cancel`, {
      method: "POST",
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${mpAccessToken()}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `cancel_${orderId}`,
      },
      cache: "no-store",
    });

    if (response.status === 404) return true;
    if (!response.ok) return false;

    const json = (await response.json()) as MpOrderResponse;
    return json.status === "canceled" || json.status === "cancelled";
  } catch (error) {
    console.error(`[mercadopago] falha ao cancelar ${orderId}:`, error);
    return false;
  }
}

/** Status da cobrança local que um status de order do MP deve produzir. */
export type MpChargeTarget = "approved" | "expired" | "cancelled" | "rejected";

/**
 * Status da Orders API → status da cobrança local.
 * Atenção à grafia: Orders usa `canceled` (um L), Payments usava `cancelled`.
 *
 * Usado pelo webhook e pela sincronização manual — as duas vias precisam
 * enxergar a order do mesmo jeito senão a reconciliação divergiria.
 */
export function targetChargeStatus(
  status: string,
  statusDetail: string,
): MpChargeTarget | null {
  switch (status) {
    case "processed":
      return "approved";
    case "expired":
      // Status próprio na Orders API (Pix não pago dentro do prazo).
      return "expired";
    case "canceled":
      // Mantém a heurística antiga como fallback: se o MP voltar a mesclar
      // expiração em `canceled`, o status_detail ainda distingue os casos.
      return /expire/i.test(statusDetail) ? "expired" : "cancelled";
    case "failed":
    case "refunded":
    case "charged_back":
      return "rejected";
    default:
      // created, processing, action_required … nada a fazer ainda.
      return null;
  }
}
