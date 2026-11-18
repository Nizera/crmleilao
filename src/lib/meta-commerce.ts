/** Public rules shared by the storefront and the server. No credentials here. */
export const MARKETING_COOKIE = 'ocdl-marketing-session-v1';
export const CONSENT_VERSION = 'store-marketing-2026-11-v1';
export const CONSENT_DAYS = 180;
export function isStoreMarketingPath(path: string) {
  return path === '/loja' || path === '/painel/loja';
}
export function cleanMetaId(value: unknown): string | null {
  return typeof value === 'string' && /^fb\.\d\.\d{10,13}\.[A-Za-z0-9_-]{1,400}$/.test(value) ? value : null;
}
export function cleanAttribution(raw: unknown) {
  const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const result: Record<string,string> = {};
  for (const name of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term']) {
    const value = input[name];
    // Campaign identifiers only; do not copy arbitrary URLs, e-mail or search text.
    if (typeof value === 'string' && /^[\p{L}\p{N}_. -]{1,120}$/u.test(value)) result[name] = value;
  }
  return result;
}
export function storeRevenue(cashTotal: number, freight: number) {
  return Math.max(0, Math.round(cashTotal*100)-Math.round(freight*100))/100;
}
