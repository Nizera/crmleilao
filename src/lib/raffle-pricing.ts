export type RafflePriceTier = { min_quantity: number; unit_price: number };

export function validateRafflePriceTiers(input: unknown, base: number, maximum: number): RafflePriceTier[] {
  if (!Array.isArray(input) || input.length > 10) throw new Error("Use até 10 faixas de promoção.");
  const tiers = input.map(row => ({ min_quantity: row?.min_quantity, unit_price: row?.unit_price })).sort((a,b) => a.min_quantity-b.min_quantity);
  let previousQuantity = 1, previousPrice = Math.round(base * 100);
  for (const tier of tiers) {
    const cents = Math.round(tier.unit_price * 100);
    if (!Number.isInteger(tier.min_quantity) || tier.min_quantity <= previousQuantity || tier.min_quantity > maximum || !Number.isFinite(tier.unit_price) || cents < 1 || cents >= previousPrice || Math.abs(tier.unit_price * 100 - cents) > 0.000001) throw new Error("Informe quantidades diferentes, de 2 até o máximo por compra, e preços menores a cada faixa (até 2 casas decimais).");
    previousQuantity = tier.min_quantity; previousPrice = cents;
  }
  return tiers;
}

export function rafflePriceQuote(base: number, tiers: RafflePriceTier[], quantity: number) {
  const qty = Number.isInteger(quantity) && quantity > 0 ? quantity : 0;
  const tier = [...tiers].sort((a,b) => b.min_quantity-a.min_quantity).find(row => qty >= row.min_quantity);
  const baseCents = Math.round(base * 100), unitCents = Math.round((tier?.unit_price ?? base) * 100);
  return { unit_price: unitCents / 100, total: unitCents * qty / 100, discount: (baseCents-unitCents)*qty/100, tier_min: tier?.min_quantity ?? null };
}
