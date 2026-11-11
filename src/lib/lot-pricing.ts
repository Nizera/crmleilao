/** Cálculo em centavos; arremate_value continua sendo o valor líquido cobrado. */
export function lotPricing(original: string, discount = "") {
  const cents = (value: string) => {
    if (!/^\d{1,9}([.,]\d{1,2})?$/.test(value.trim())) throw new Error("Informe um valor válido em reais.");
    return Math.round(Number(value.replace(",", ".")) * 100);
  };
  const gross = cents(original);
  const off = discount.trim() ? cents(discount) : 0;
  if (off > gross) throw new Error("O desconto não pode ser maior que o valor do lote.");
  return { original: gross / 100, discount: off / 100, total: (gross - off) / 100 };
}
