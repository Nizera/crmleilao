/** Preço informado pelo provedor, em reais. Não confundir desconto com ajuste. */
export function observedShipmentPrice(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\d+(\.\d{1,2})?$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 99999999.99 && Math.abs(number * 100 - Math.round(number * 100)) < .00001 ? Math.round(number * 100) / 100 : null;
}
