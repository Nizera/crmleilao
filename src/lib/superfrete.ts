import "server-only";

import type { ShipmentStatus } from "@/lib/shipments";
import { siteUrl } from "@/lib/lots";

/**
 * Cliente HTTP da SuperFrete — API v0 (sem SDK).
 *
 * Ambientes:
 *   sandbox   https://sandbox.superfrete.com   (SUPERFRETE_SANDBOX != "false")
 *   produção  https://api.superfrete.com
 * Token em SUPERFRETE_TOKEN (painel > Integrações > Integrar em Desenvolvedores)
 * e User-Agent em SUPERFRETE_USER_AGENT, no formato "NomeDaApp (email)".
 *
 * Fluxo de etiqueta (documentação: superfrete.readme.io):
 *   1. POST /api/v0/calculator   cotação (opcional, escolha do admin)
 *   2. POST /api/v0/cart         cria a etiqueta em status "pending"
 *   3. POST /api/v0/checkout     paga com o saldo da carteira → "released"
 *   4. GET  /api/v0/order/info/{id}  status, rastreio e link do PDF
 *   5. webhook (POST /api/v0/webhook) notifica posted/delivered/cancelled
 */

export type SfServiceId = 1 | 2 | 3 | 17 | 31 | 33;

export const SUPERFRETE_SERVICES: { id: SfServiceId; label: string }[] = [
  { id: 1, label: "PAC" },
  { id: 2, label: "SEDEX" },
  { id: 17, label: "Mini Envios" },
  { id: 3, label: "Jadlog" },
  { id: 31, label: "Loggi" },
  { id: 33, label: "J&T" },
];

export function sfServiceLabel(serviceId: number | null | undefined): string {
  if (serviceId == null) return "—";
  return (
    SUPERFRETE_SERVICES.find((service) => service.id === serviceId)?.label ??
    `Serviço ${serviceId}`
  );
}

/** Sandbox é o padrão; só produção quando SUPERFRETE_SANDBOX="false". */
export function sfSandbox(): boolean {
  return process.env.SUPERFRETE_SANDBOX !== "false";
}

export function sfBaseUrl(): string {
  return sfSandbox()
    ? "https://sandbox.superfrete.com"
    : "https://api.superfrete.com";
}

export function sfConfigured(): boolean {
  return Boolean(process.env.SUPERFRETE_TOKEN?.trim());
}

function sfToken(): string {
  const token = process.env.SUPERFRETE_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "SuperFrete não configurada: defina SUPERFRETE_TOKEN no .env e reinicie o servidor.",
    );
  }
  return token;
}

/** URL pública que recebe os eventos (cadastrada via POST /api/v0/webhook). */
export function sfWebhookUrl(): string {
  return `${siteUrl()}/api/webhooks/superfrete`;
}

async function sfFetch(
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<unknown> {
  const response = await fetch(`${sfBaseUrl()}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${sfToken()}`,
      "User-Agent":
        process.env.SUPERFRETE_USER_AGENT?.trim() ||
        "CarasLegendsCRM (contato@exemplo.com)",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    cache: "no-store",
  });

  const json: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = json
      ? JSON.stringify(json).slice(0, 400)
      : `HTTP ${response.status}`;
    throw new Error(`SuperFrete: ${detail}`);
  }

  return json;
}

/* -------------------------------------------------------------------------- */
/*  Tipos                                                                      */
/* -------------------------------------------------------------------------- */

export type SfVolume = {
  height: number;
  width: number;
  length: number;
  weight: number;
};

export type SfParty = {
  name: string;
  address: string;
  number?: string;
  complement?: string;
  district: string;
  city: string;
  state_abbr: string;
  postal_code: string;
  email?: string | null;
  phone?: string | null;
  document?: string | null;
};

export type SfQuoteOption = {
  id: number;
  name: string;
  price: number;
  discount: number;
  deliveryTime: number;
  carrier: string;
};

export type SfQuoteResult = {
  options: SfQuoteOption[];
  /** Motivos por serviço de recusas informadas pela SuperFrete (ex.: seguro abaixo do mínimo dos Correios). */
  errors: string[];
};

type SfQuoteRaw = {
  id?: number;
  name?: string;
  price?: number;
  discount?: string | number;
  delivery_time?: number;
  company?: { name?: string };
  has_error?: boolean;
  /** Mensagem de recusa da transportadora (ex.: seguro abaixo do mínimo). */
  error?: string;
};

/**
 * Cotação multi-transportadora.
 *
 * - Serviços com `has_error: true` (sem ponto de postagem próximo ao CEP de
 *   origem, limite excedido…) são simplesmente ignorados, como antes.
 * - Serviços recusados com mensagem no campo `error` (ex.: "Valor segurado é
 *   abaixo do limite mínimo de R$ 25,63" dos Correios) são descartados e a
 *   mensagem é devolvida em `errors` para a UI explicar o motivo.
 * - A SuperFrete às vezes responde sem erro declarado, porém com `price: 0` e
 *   `delivery_time: 0` (falha transitória ao acionar a transportadora). Essas
 *   opções não são cotação real: são descartadas e, se alguma vier assim, a
 *   chamada é refita uma única vez para tentar recuperá-la.
 */
export async function quoteFrete(input: {
  fromCep: string;
  toCep: string;
  volume: SfVolume;
  insuranceValue?: number;
}): Promise<SfQuoteResult> {
  const insurance = input.insuranceValue ?? 0;

  const request = (): Promise<SfQuoteRaw[]> =>
    sfFetch("/api/v0/calculator", {
      method: "POST",
      body: {
        from: { postal_code: input.fromCep },
        to: { postal_code: input.toCep },
        services: "1,2,17,3,31,33",
        options: {
          own_hand: false,
          receipt: false,
          insurance_value: insurance,
          use_insurance_value: insurance > 0,
        },
        package: input.volume,
      },
    }).then((json) => (Array.isArray(json) ? (json as SfQuoteRaw[]) : []));

  const isServiceError = (option: SfQuoteRaw): boolean =>
    typeof option.error === "string" && option.error.trim().length > 0;

  const toOptions = (raw: SfQuoteRaw[]): SfQuoteOption[] =>
    raw
      .filter(
        (option) => !option.has_error && !isServiceError(option) && option.id != null,
      )
      .map((option) => ({
        id: Number(option.id),
        name: option.name ?? `Serviço ${option.id}`,
        price: Number(option.price ?? 0),
        discount: Number(option.discount ?? 0),
        deliveryTime: Number(option.delivery_time ?? 0),
        carrier: option.company?.name ?? "",
      }))
      .filter((option) => Number.isFinite(option.price) && option.price > 0);

  const isTransient = (option: SfQuoteRaw): boolean =>
    !option.has_error &&
    !isServiceError(option) &&
    option.id != null &&
    !(Number(option.price ?? 0) > 0);

  const toErrors = (raw: SfQuoteRaw[]): string[] => [
    ...new Set(
      raw
        .filter((option) => isServiceError(option))
        .map(
          (option) =>
            `${option.company?.name || option.name || `Serviço ${option.id}`}: ${(option.error ?? "").trim()}`,
        ),
    ),
  ];

  const first = await request();
  let chosen = first;
  if (first.some(isTransient)) {
    const retried = await request();
    if (toOptions(retried).length >= toOptions(first).length) chosen = retried;
  }

  return { options: toOptions(chosen), errors: toErrors(chosen) };
}

export type SfProduct = {
  name: string;
  quantity: number;
  unitary_value: number;
};

/** Cria a etiqueta em status "pending" (aguardando pagamento no checkout). */
export async function createCart(input: {
  from: SfParty;
  to: SfParty;
  service: number;
  products: SfProduct[];
  volume: SfVolume;
  insuranceValue?: number;
}): Promise<{ id: string; price: number; status: string }> {
  const json = (await sfFetch("/api/v0/cart", {
    method: "POST",
    body: {
      from: input.from,
      to: input.to,
      service: input.service,
      products: input.products,
      volumes: input.volume,
      options: {
        // Declaração de conteúdo (sem nota fiscal) + valor declarado.
        // Sem seguro, a doc pede `insurance_value: null`.
        non_commercial: true,
        insurance_value:
          input.insuranceValue != null && input.insuranceValue > 0
            ? input.insuranceValue
            : null,
      },
      platform: "CarasLegendsCRM",
    },
  })) as { id?: string; price?: number; status?: string };

  if (!json?.id) {
    throw new Error("SuperFrete não devolveu o id da etiqueta.");
  }

  return {
    id: String(json.id),
    price: Number(json.price ?? 0),
    status: json.status ?? "pending",
  };
}

/** Paga a etiqueta com o saldo da carteira (necessário saldo suficiente). */
export async function checkoutOrders(orderIds: string[]): Promise<void> {
  await sfFetch("/api/v0/checkout", {
    method: "POST",
    body: { orders: orderIds },
  });
}

export type SfOrderInfo = {
  id: string;
  status: string;
  price: number;
  discount: number;
  service_id: number | null;
  tracking: string | null;
  print: { url?: string } | null;
  delivery?: number | null;
  paid_at?: string | null;
  posted_at?: string | null;
  generated_at?: string | null;
};

/** Status, rastreio e PDF da etiqueta. */
export async function getOrderInfo(orderId: string): Promise<SfOrderInfo> {
  const json = (await sfFetch(
    `/api/v0/order/info/${encodeURIComponent(orderId)}`,
  )) as SfOrderInfo;
  if (!json?.id) {
    throw new Error("SuperFrete não devolveu os dados do pedido.");
  }
  return json;
}

/** URL do PDF da etiqueta (mesma que order/info traz em print.url). */
export async function tagPrintUrl(orderId: string): Promise<string> {
  const json = (await sfFetch("/api/v0/tag/print", {
    method: "POST",
    body: { orders: [orderId] },
  })) as { url?: string };
  if (!json?.url) throw new Error("SuperFrete não devolveu o link da etiqueta.");
  return json.url;
}

/** Cancela a etiqueta (só antes da postagem); o valor volta à carteira. */
export async function cancelOrder(
  orderId: string,
  description: string,
): Promise<void> {
  await sfFetch("/api/v0/order/cancel", {
    method: "POST",
    body: { order: { id: orderId, description: description.slice(0, 255) } },
  });
}

export const SUPERFRETE_WEBHOOK_EVENTS = [
  "order.created",
  "order.released",
  "order.generated",
  "order.posted",
  "order.delivered",
  "order.cancelled",
] as const;

/**
 * Cadastra o webhook da aplicação. A resposta traz o `secret_token` usado
 * para validar o header X-ME-Signature — guarde-o (em `app_secrets`).
 */
export async function createWebhookApp(input: {
  name: string;
  url: string;
}): Promise<{ id: string; secretToken: string }> {
  const json = (await sfFetch("/api/v0/webhook", {
    method: "POST",
    body: {
      name: input.name.slice(0, 60),
      url: input.url,
      events: [...SUPERFRETE_WEBHOOK_EVENTS],
    },
  })) as { id?: string; secret_token?: string };

  if (!json?.secret_token) {
    throw new Error("SuperFrete não devolveu o secret_token do webhook.");
  }

  return { id: String(json.id ?? ""), secretToken: json.secret_token };
}

/* -------------------------------------------------------------------------- */
/*  Status                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Status da etiqueta → status do nosso envio.
 * A API usa "cancelled" (inglês US) no webhook e "canceled" em order/info.
 */
export function normalizeSfStatus(status: string): ShipmentStatus | null {
  switch (status) {
    case "pending":
      return "pending";
    case "released":
      return "released";
    case "posted":
      return "posted";
    case "delivered":
      return "delivered";
    case "canceled":
    case "cancelled":
      return "cancelled";
    default:
      return null;
  }
}

/** Rastreio oficial quando o webhook não traz tracking_url. */
export function fallbackTrackingUrl(tracking: string): string | null {
  if (/^[A-Z]{2}\d{9}BR$/.test(tracking)) {
    return `https://www.correios.com.br/rastreio?codigo=${encodeURIComponent(tracking)}`;
  }
  return null;
}
