import "server-only";

import { headers } from "next/headers";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Limite de tentativas das telas públicas (login, convite).
 *
 * O contador é gravado no banco (migração 0010) porque as server actions não
 * compartilham memória entre instâncias. `bump_rate_limit` faz um upsert
 * atômico, então duas requisições simultâneas nunca passam ambas.
 *
 * Falha fechada: sem o contador persistente não permitimos uma tentativa que
 * ignore o limite. Isso mantém o login e o aceite de convites protegidos em
 * caso de indisponibilidade ou migration pendente.
 */
export type RateBucket =
  | "store-catalog-write"
  | "store-checkout"
  | "store-sync"
  | "admin-signin"
  | "customer-signin"
  | "invite-accept"
  | "customer-password"
  | "ip-only";

const RULES: Record<RateBucket, { limit: number; window: number }> = {
  "store-catalog-write": { limit: 60, window: 300 },
  "store-checkout": { limit: 12, window: 300 },
  "store-sync": { limit: 15, window: 60 },
  // Senha de 8+ caracteres: volume baixo por conta.
  "admin-signin": { limit: 5, window: 900 },
  "customer-signin": { limit: 5, window: 900 },
  // Convite é uso único, mas a tentativa de adivinhar token não pode ser livre.
  "invite-accept": { limit: 15, window: 900 },
  // Troca de senha: aqui o limite é o do dono da conta, porque a confirmação
  // da senha atual é o que alguém de fora tentaria chutar.
  "customer-password": { limit: 5, window: 900 },
  // Teto por IP. Os outros buckets são por assunto (e-mail/telefone/token):
  // trocar o assunto zera a chave, então este teto é o que impede enumeração
  // em massa a partir de um único lugar.
  "ip-only": { limit: 30, window: 900 },
};

/**
 * IP do chamador. Na Vercel o `x-forwarded-for` é gravado pelo próprio
 * edge/router e o valor do cliente é sobrescrito, então o primeiro campo é o
 * IP real e não é forjável. Fora da Vercel (proxy próprio) certifique-se de
 * que o proxy sobrescreva o header antes de confiar nele.
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
      return false;
    }
    return data !== false;
  } catch (error) {
    console.warn("[rate-limit] indisponível:", error);
    return false;
  }
}

/**
 * Contador das telas públicas: um por assunto (e-mail/telefone/token) **e**
 * um teto por IP, na mesma chamada. Assunto é o que protege o dono de conta;
 * o teto por IP é o que segura quem troca de assunto a cada tentativa.
 */
export async function allowPublic(
  bucket: RateBucket,
  subject: string,
): Promise<boolean> {
  const ip = await clientIp();
  if (!(await allow(bucket, subject, [ip]))) return false;
  return allow("ip-only", ip);
}
