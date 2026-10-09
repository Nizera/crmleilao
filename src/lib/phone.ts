/** Formata "11999998888" / "+5511999998888" para E.164 com DDI 55. */
export function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;

  const withDdi = digits.startsWith("55") ? digits : `55${digits}`;
  // 55 + DDD (2) + número (8 ou 9)
  if (withDdi.length !== 12 && withDdi.length !== 13) return null;
  if (withDdi.length === 12 && withDdi.slice(4, 6) === "0") return null;

  return `+${withDdi}`;
}
