/** Preço informado pelo provedor, em reais. Não confundir desconto com ajuste. */
export function observedShipmentPrice(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\d+(\.\d{1,2})?$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 99999999.99 && Math.abs(number * 100 - Math.round(number * 100)) < .00001 ? Math.round(number * 100) / 100 : null;
}

/** A SuperFrete mantém `price` da emissão; a aferição fica em service_posted. */
export function superfreteOrderPrice(info: unknown, previous?: unknown, original?: unknown): number | null {
  if (!info || typeof info !== "object" || Array.isArray(info)) return null;
  const order = info as Record<string, unknown>;
  const posted = order.service_posted;
  if (posted && typeof posted === "object" && !Array.isArray(posted)) {
    const final = observedShipmentPrice((posted as Record<string, unknown>).total_with_discount);
    // Zero costuma ser um placeholder antes da aferição, não frete gratuito.
    if (final !== null && final > 0) return final;
  }
  const initial = observedShipmentPrice(order.price);
  const known = observedShipmentPrice(previous);
  const baseline = observedShipmentPrice(original);
  // Uma resposta ainda sem aferição não desfaz um ajuste já observado.
  if (known !== null && baseline !== null && known !== baseline && initial === baseline) return known;
  return initial;
}
