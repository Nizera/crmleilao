import "server-only";

import { headers } from "next/headers";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Limite de tentativas das telas públicas (login, OTP, convite).
 *
 * O contador é gravado no banco (migração 0010) porque as server actions não
 * compartilham memória entre instâncias. `bump_rate_limit` faz um upsert
 * atômico, então duas requisições simultâneas nunca passam ambas.
 *
 * Falha aberta de propósito: se a migração ainda não foi aplicada, o login
 * continua funcionando (só perde a proteção) em vez de derrubar o acesso.
 */
export type RateBucket =
  | "otp-request"
  | "otp-verify"
  | "admin-signin"
  | "customer-signin"
  | "invite-accept";

const RULES: Record<RateBucket, { limit: number; window: number }> = {
  // Evita SMS/viagem para qualquer número e brute force do código de 6 dígitos.
  "otp-request": { limit: 3, window: 600 },
  "otp-verify": { limit: 10, window: 600 },
  // Senha de 8+ caracteres: volume baixo por conta.
  "admin-signin": { limit: 5, window: 900 },
  "customer-signin": { limit: 5, window: 900 },
  // Convite é uso único, mas a tentativa de adivinhar token não pode ser livre.
  "invite-accept": { limit: 15, window: 900 },
};

/**
 * IP do chamador. Server actions recebem os headers da requisição que as
 * invocou; atrás de proxy, `x-forwarded-for` traz o cliente real.
 */
export async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0]!.trim();
    const real = h.get("x-real-ip");
    if (real) return real.trim();
    return "unknown";
  } catch {
    // Chamado fora do contexto de requisição (ex.: teste).
    return "unknown";
  }
}

/**
 * Consuma uma unidade do contador. Devolve `false` quando o limite da janela
 * foi atingido — o chamador deve recusar a operação.
 *
 * `subject` fica junto do bucket na chave: o limite é por usuário/número,
 * não global, para um usuário não derrubar o acesso dos demais.
 */
export async function allow(
  bucket: RateBucket,
  subject: string,
  extra: string[] = [],
): Promise<boolean> {
  const { limit, window: seconds } = RULES[bucket];
  const parts = [bucket, subject, ...extra];
  const key = parts.join("|").slice(0, 200);

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("bump_rate_limit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: seconds,
    });

    if (error) {
      console.warn(`[rate-limit] ${bucket}: ${error.message}`);
      return true;
    }
    return data !== false;
  } catch (error) {
    console.warn("[rate-limit] indisponível:", error);
    return true;
  }
}
