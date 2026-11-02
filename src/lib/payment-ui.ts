/** Prazo no navegador só controla a instrução de pagar, nunca a liquidação. */
export function isPaymentExpired(expiresAt: string | null, now: number): boolean {
  const deadline = expiresAt ? Date.parse(expiresAt) : NaN;
  return Number.isFinite(deadline) && now >= deadline;
}
