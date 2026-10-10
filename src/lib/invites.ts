import { createHash, randomBytes } from "node:crypto";

/** Gera o token cru que vai na URL do convite (43 chars, base64url). */
export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/** sha256 hex do token — é o único valor guardado em customer_invites. */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
