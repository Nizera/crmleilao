import { createHash, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";

import { settleChargeByReference } from "@/lib/charges-server";
import { getPayment } from "@/lib/mercadopago";

/**
 * Webhook do Mercado Pago (F3).
 *
 * Segurança em três camadas:
 *  1. token secreto no path (`MP_WEBHOOK_TOKEN`), comparado em tempo constante;
 *  2. a notificação só traz o id — o pagamento é REBUSCADO na API do MP;
 *  3. o `external_reference` precisa pertencer a uma cobrança nossa, com o
 *     mesmo valor (cheque em settleChargeByReference).
 *
 * Aceita POST (webhooks v2: {data:{id}}) e GET (IPN legado: ?topic=payment&id=).
 */

const JSON_HEADERS = { "Content-Type": "application/json" };

function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

/** Extrai o id numérico do pagamento da notificação (ou null para ignorar). */
function extractPaymentId(body: unknown, searchParams: URLSearchParams): string | null {
  const topic =
    searchParams.get("topic") ?? searchParams.get("type") ?? searchParams.get("action");
  if (topic && !/payment/i.test(topic.toLowerCase())) return null;

  const fromQuery = searchParams.get("id") ?? searchParams.get("data.id");
  if (fromQuery && /^\d+$/.test(fromQuery)) return fromQuery;

  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;

    // Só notificações de pagamento: merchant_order etc. têm id próprio na
    // sequência deles e seriam consultados como se fosse pagamento.
    const kind = [record.type, record.topic, record.action]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .toLowerCase();
    if (kind && !kind.includes("payment")) return null;

    const data = record.data;
    if (data && typeof data === "object") {
      const inner = data as Record<string, unknown>;
      if (inner.id != null && /^\d+$/.test(String(inner.id))) return String(inner.id);
    }

    if (record.id != null && /^\d+$/.test(String(record.id))) {
      return String(record.id);
    }

    if (typeof record.resource === "string") {
      const match = record.resource.match(/\/(\d+)$/);
      if (match) return match[1];
    }
  }

  return null;
}

function targetForStatus(status: string) {
  switch (status) {
    case "approved":
      return "approved" as const;
    case "expired":
      return "expired" as const;
    case "cancelled":
      return "cancelled" as const;
    case "rejected":
    case "refunded":
    case "charged_back":
      return "rejected" as const;
    default:
      // pending, in_process, authorized … nada a fazer ainda.
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
  const paymentId = extractPaymentId(body, request.nextUrl.searchParams);

  if (!paymentId) {
    // Notificação de outro assunto (merchant_order, etc.) ou sem id: só ak.
    return new Response(JSON.stringify({ ok: true, ignored: true }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  }

  let payment;
  try {
    payment = await getPayment(paymentId);
  } catch (error) {
    // Falha transitória: devolve 500 para o MP reenviar.
    console.error("[mercadopago-webhook] falha ao consultar:", error);
    return new Response(JSON.stringify({ error: "retry" }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }

  if (!payment) {
    return new Response(JSON.stringify({ ok: true, ignored: "payment_not_found" }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  }

  const target = targetForStatus(payment.status);
  if (!target || !payment.externalReference?.startsWith("chg_")) {
    return new Response(JSON.stringify({ ok: true, ignored: true }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  }

  let result;
  try {
    result = await settleChargeByReference({
      externalReference: payment.externalReference,
      target,
      mpPaymentId: payment.id,
      amount: payment.amount,
      paidAt: payment.dateApproved,
    });
  } catch (error) {
    console.error("[mercadopago-webhook] falha ao aplicar status:", error);
    return new Response(JSON.stringify({ error: "retry" }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }

  console.log(
    `[mercadopago-webhook] pagamento ${payment.id} → ${payment.status}` +
      ` (cobrança ${payment.externalReference}): ${result.ok ? "aplicado" : result.reason}`,
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
