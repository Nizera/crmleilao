import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";

import { applySuperfreteEvent, getWebhookSecret } from "@/lib/shipments-server";

/**
 * Webhook da SuperFrete (F4).
 *
 * Segurança:
 *  1. valida `X-ME-Signature` = HMAC-SHA256(corpo, secret_token) — o secret é
 *     o devolvido ao cadastrar o Webhook App (POST /api/v0/webhook), gravado
 *     em app_secrets (key = superfrete_webhook_secret, só service role);
 *  2. o evento é aplicado por id da etiqueta (`data.id`), com transição
 *     monotônica idempotente em applySuperfreteEvent.
 *
 * A SuperFrete reenvia em falha (5 tentativas / 15 min): devolvemos 500 em
 * erro transitório e 200 para eventos ignorados.
 */

const JSON_HEADERS = { "Content-Type": "application/json" };

function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

/** Assinaturas esperadas: hex (padrão) e base64 — a doc não fixa o encoding. */
function isValidSignature(rawBody: string, header: string, secret: string): boolean {
  const hex = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const base64 = Buffer.from(hex, "hex").toString("base64");
  const trimmed = header.trim();
  return (
    safeEqual(trimmed.toLowerCase(), hex.toLowerCase()) ||
    safeEqual(trimmed, base64)
  );
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export async function POST(request: NextRequest): Promise<Response> {
  const secret = await getWebhookSecret();
  if (!secret) {
    console.error("[superfrete-webhook] webhook não ativado (sem secret)");
    return json({ error: "webhook não ativado" }, 503);
  }

  const signature = request.headers.get("x-me-signature");
  const rawBody = await request.text();

  if (!signature || !isValidSignature(rawBody, signature, secret)) {
    return json({ error: "assinatura inválida" }, 401);
  }

  let payload: { event?: unknown; data?: unknown };
  try {
    payload = JSON.parse(rawBody) as typeof payload;
  } catch {
    return json({ ok: true, ignored: "invalid_json" }, 200);
  }

  const event = typeof payload.event === "string" ? payload.event : "";
  if (!event.startsWith("order.")) {
    return json({ ok: true, ignored: true }, 200);
  }

  const data =
    payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : {};
  const sfOrderId = typeof data.id === "string" ? data.id : null;
  if (!sfOrderId) {
    return json({ ok: true, ignored: "no_id" }, 200);
  }

  let result;
  try {
    result = await applySuperfreteEvent({ sfOrderId, event, data });
  } catch (error) {
    console.error("[superfrete-webhook] falha ao aplicar:", error);
    return json({ error: "retry" }, 500);
  }

  if (result.reason === "not_found") {
    // Etiqueta de outra conta/ambiente: não reprocessa.
    return json({ ok: true, ignored: "unknown_order" }, 200);
  }

  console.log(
    `[superfrete-webhook] ${event} (${sfOrderId}): ${result.ok ? "aplicado" : result.reason}`,
  );

  if (result.ok) {
    revalidatePath("/admin/envios");
    revalidatePath("/painel");
    revalidatePath("/admin/lotes");
    revalidatePath("/admin/dashboard");
  }

  return json(result, 200);
}
