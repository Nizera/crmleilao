import { createHash, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";

import { settleChargeByReference } from "@/lib/charges-server";
import { getOrder } from "@/lib/mercadopago";

/**
 * Webhook do Mercado Pago (F3 — Orders API, tópico `order`).
 *
 * Segurança em três camadas:
 *  1. token secreto no path (`MP_WEBHOOK_TOKEN`), comparado em tempo constante;
 *  2. a notificação só traz o id — a order é REBUSCADA na API do MP;
 *  3. o `external_reference` precisa pertencer a uma cobrança nossa, com o
 *     mesmo valor (cheque em settleChargeByReference).
 *
 * A URL precisa estar cadastrada em Suas integrações → Webhooks (evento
 * Order) do painel do MP — com a Orders API não existe mais
 * `notification_url` no body.
 *
 * Aceita POST (webhooks v2: {data:{id}}) e GET (query ?type=order&data.id=).
 */

const JSON_HEADERS = { "Content-Type": "application/json" };

function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

/** Ids de order da Orders API: alfanuméricos com prefixo (ORD…). */
const ORDER_ID = /^[A-Za-z][A-Za-z0-9_-]{3,}$/;

/** Extrai o id da order da notificação (ou null para ignorar). */
function extractOrderId(body: unknown, searchParams: URLSearchParams): string | null {
  const topic =
    searchParams.get("topic") ?? searchParams.get("type") ?? searchParams.get("action");
  if (topic && !/order|payment/i.test(topic)) return null;

  const fromQuery = searchParams.get("id") ?? searchParams.get("data.id");
  if (fromQuery && ORDER_ID.test(fromQuery)) return fromQuery;

  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;

    // Só notificações de order/pagamento: merchant_order etc. têm id próprio
    // na sequência deles e seriam consultados como se fosse a nossa order
    // (ids numéricos não passam no filtro ORDER_ID logo abaixo).
    const kind = [record.type, record.topic, record.action]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .toLowerCase();
    if (kind && !/order|payment/.test(kind)) return null;

    const data = record.data;
    if (data && typeof data === "object") {
      const inner = data as Record<string, unknown>;
      if (inner.id != null && ORDER_ID.test(String(inner.id))) {
        return String(inner.id);
      }
    }

    if (record.id != null && ORDER_ID.test(String(record.id))) {
      return String(record.id);
    }

    if (typeof record.resource === "string") {
      const match = record.resource.match(/\/([A-Za-z][A-Za-z0-9_-]{3,})$/);
      if (match) return match[1];
    }
  }

  return null;
}

/**
 * Status da Orders API → status da cobrança local.
 * Atenção à grafia: Orders usa `canceled` (um L), Payments usava `cancelled`.
 */
function targetForStatus(status: string, statusDetail: string) {
  switch (status) {
    case "processed":
      return "approved" as const;
    case "canceled":
      // A Orders API mesclou expiração e cancelamento em `canceled`.
      return /cancel/i.test(statusDetail)
        ? ("cancelled" as const)
        : ("expired" as const);
    case "failed":
    case "refunded":
    case "charged_back":
      return "rejected" as const;
    default:
      // action_required, processing … nada a fazer ainda.
      return null;
  }
}

async function handle(
  request: NextRequest,
  token: string,
): Promise<Response> {
  const expected = process.env.MP_WEBHOOK_TOKEN?.trim();
  if (!expected) {
    console.error("[mercadopago-webhook] MP_WEBHOOK_TOKEN não configurado");
    return new Response(JSON.stringify({ error: "webhook não configurado" }), {
      status: 503,
      headers: JSON_HEADERS,
    });
  }

  if (!token || !safeEqual(token, expected)) {
    // Não revela se o problema é o token.
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: JSON_HEADERS,
    });
  }

  let body: unknown = null;
  if (request.method === "POST") {
    body = await request.json().catch(() => null);
  }
  const orderId = extractOrderId(body, request.nextUrl.searchParams);

  if (!orderId) {
    // Notificação de outro assunto (merchant_order, etc.) ou sem id: só ak.
    return new Response(JSON.stringify({ ok: true, ignored: true }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  }

  let order;
  try {
    order = await getOrder(orderId);
  } catch (error) {
    // Falha transitória: devolve 500 para o MP reenviar.
    console.error("[mercadopago-webhook] falha ao consultar:", error);
    return new Response(JSON.stringify({ error: "retry" }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }

  if (!order) {
    return new Response(JSON.stringify({ ok: true, ignored: "order_not_found" }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  }

  const target = targetForStatus(order.status, order.statusDetail);
  if (!target || !order.externalReference?.startsWith("chg_")) {
    return new Response(JSON.stringify({ ok: true, ignored: true }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  }

  let result;
  try {
    result = await settleChargeByReference({
      externalReference: order.externalReference,
      target,
      mpPaymentId: order.id,
      amount: order.amount,
      paidAt: order.dateApproved,
    });
  } catch (error) {
    console.error("[mercadopago-webhook] falha ao aplicar status:", error);
    return new Response(JSON.stringify({ error: "retry" }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }

  console.log(
    `[mercadopago-webhook] order ${order.id} → ${order.status}` +
      ` (cobrança ${order.externalReference}): ${result.ok ? "aplicado" : result.reason}`,
  );

  if (result.ok) {
    revalidatePath("/admin/cobrancas");
    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/lotes");
    revalidatePath("/painel");
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: JSON_HEADERS,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  return handle(request, token);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  return handle(request, token);
}
