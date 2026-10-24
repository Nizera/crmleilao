import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import type { NextRequest } from "next/server";

import { settleChargeByReference } from "@/lib/charges-server";
import { getOrder, targetChargeStatus } from "@/lib/mercadopago";

/**
 * Webhook do Mercado Pago (F3 — Orders API, tópico `order`).
 *
 * Segurança em quatro camadas:
 *  1. token secreto no path (`MP_WEBHOOK_TOKEN`), comparado em tempo constante;
 *  2. assinatura HMAC `x-signature` (MP_WEBHOOK_SECRET) — veda replay/forja
 *     de origem mesmo com o token vazado;
 *  3. a notificação só traz o id — a order é REBUSCADA na API do MP;
 *  4. o `external_reference` precisa pertencer a uma cobrança nossa, com o
 *     mesmo valor (cheque em settleChargeByReference).
 *
 * A URL precisa estar cadastrada em Suas integrações → Webhooks (evento
 * Order) do painel do MP — com a Orders API não existe mais
 * `notification_url` no body.
 *
 * Aceita POST (webhooks v2: {data:{id}}) e GET (query ?type=order&data.id=).
 */

const JSON_HEADERS = { "Content-Type": "application/json" };

/** Tolerância de replay: assinatura com `ts` além disto é recusada. */
// O MP reenvia notificações não confirmadas por dias (15 min, 30 min, 6 h,
// 48 h, 96 h) e a doc não diz se o reenvio é reassinado com `ts` novo. Uma
// janela de 10 min rejeitaria reenvios legítimos. Replay aqui é inofensivo:
// a order é rebuscada na API e a transição de status é idempotente.
const SIGNATURE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Ids candidatos a entrar no manifesto da assinatura.
 *
 * O MP calcula o HMAC sobre `id:<data.id>`, mas o id aparece em lugares
 * diferentes conforme o formato: GET legado traz `?data.id=` na query, o
 * webhook v2 de POST traz `{data:{id}}` no body. Assinar só com a query faria
 * todo POST de pagamento cair em 401 com o secret configurado — então o
 * manifesto é montado para cada candidato e basta um bater.
 *
 * Lista vazia (nenhum id em lugar nenhum) vira `[""]`: o par `id:` é omitido,
 * como manda a documentação.
 */
function signatureIdCandidates(body: unknown, search: URLSearchParams): string[] {
  const candidates: (string | null)[] = [
    search.get("data.id"),
    search.get("id"),
  ];

  if (body && typeof body === "object") {
    const data = (body as Record<string, unknown>).data;
    if (data && typeof data === "object") {
      const innerId = (data as Record<string, unknown>).id;
      if (innerId != null) candidates.push(String(innerId));
    }
  }

  // A doc do MP manda converter o data.id para MINÚSCULAS no manifesto quando
  // ele é alfanumérico em maiúsculas (ex.: ORD01JQ… → ord01jq…). Os ids da
  // Orders API são sempre assim. Mantém-se também o valor original por
  // segurança (ids numéricos/legados não mudam com o lower-case).
  const unique = [
    ...new Set(
      candidates
        .filter((value): value is string => !!value && value.length > 0)
        .flatMap((value) => [value.toLowerCase(), value]),
    ),
  ];
  return unique.length > 0 ? unique : [""];
}

/**
 * Valida `x-signature` conforme o algoritmo oficial do MP:
 *   1. extrai `ts` e `v1` do header (`ts=…,v1=…`);
 *   2. monta o manifesto `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
 *      para cada id candidato, omitindo os pares cujos valores não vieram;
 *   3. HMAC-SHA256(secret, manifesto) em hex;
 *   4. compara com `v1` em tempo constante.
 *
 * Retorna `null` quando válido, ou o motivo da rejeição.
 */
function verifySignature(
  request: NextRequest,
  dataIds: string[],
): string | null {
  const secret = process.env.MP_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return "secret não configurado";
  }

  const header = request.headers.get("x-signature");
  if (!header) return "header ausente";

  const parts = new Map<string, string>();
  for (const chunk of header.split(",")) {
    const idx = chunk.indexOf("=");
    if (idx <= 0) continue;
    parts.set(chunk.slice(0, idx).trim(), chunk.slice(idx + 1).trim());
  }

  const ts = parts.get("ts");
  const v1 = parts.get("v1");
  if (!ts || !v1) return "ts/v1 ausentes no header";

  // A documentação atual diz `ts` em milissegundos e o exemplo oficial é de
  // 13 dígitos (`ts=1742505638683`) — nesse formato a linha abaixo é um
  // no-op. Ela fica como rede de segurança: se um dia o valor vier em
  // segundos (~1,7e9), sem converter a idade daria ~1,7 trilhão e TODA
  // notificação cairia em "fora da janela". Abaixo de 1e11 (ms ≈ 1973,
  // s ≈ 5138) são segundos. O manifesto continua usando o `ts` exatamente
  // como veio — só a checagem de idade normaliza.
  const tsNumber = Number(ts);
  const tsMs = tsNumber < 1e11 ? tsNumber * 1000 : tsNumber;
  const age = Date.now() - tsMs;
  if (!Number.isFinite(age) || Math.abs(age) > SIGNATURE_MAX_AGE_MS) {
    return "assinatura fora da janela de tolerância";
  }

  const requestId = request.headers.get("x-request-id") ?? "";

  for (const dataId of dataIds) {
    const manifest =
      (dataId ? `id:${dataId};` : "") +
      (requestId ? `request-id:${requestId};` : "") +
      `ts:${ts};`;

    const digest = createHmac("sha256", secret).update(manifest).digest("hex");
    if (safeEqual(digest, v1)) return null;
  }

  return "hmac não confere";
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

  // O body é lido ANTES da assinatura: no webhook v2 o `data.id` está nele e
  // entra no manifesto. Só existe um parse — depois reaproveitamos `body`.
  let body: unknown = null;
  if (request.method === "POST") {
    body = await request.json().catch(() => null);
  }

  const signatureError = verifySignature(
    request,
    signatureIdCandidates(body, request.nextUrl.searchParams),
  );
  if (signatureError) {
    if (signatureError === "secret não configurado") {
      console.error("[mercadopago-webhook] MP_WEBHOOK_SECRET não configurado");
      return new Response(JSON.stringify({ error: "webhook não configurado" }), {
        status: 503,
        headers: JSON_HEADERS,
      });
    }
    console.warn(
      `[mercadopago-webhook] assinatura rejeitada: ${signatureError}`,
    );
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: JSON_HEADERS,
    });
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

  const target = targetChargeStatus(order.status, order.statusDetail);
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
    revalidateTag("dashboard", { expire: 0 });
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
