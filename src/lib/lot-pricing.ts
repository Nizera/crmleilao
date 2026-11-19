/** Cálculo em centavos; arremate_value continua sendo o valor líquido cobrado. */
export function lotPricing(original: string, discount = "", voucher = "") {
  const cents = (value: string) => {
    if (!/^\d{1,9}([.,]\d{1,2})?$/.test(value.trim())) throw new Error("Informe um valor válido em reais.");
    return Math.round(Number(value.replace(",", ".")) * 100);
  };
  const gross = cents(original);
  const manual = discount.trim() ? cents(discount) : 0;
  const credit = voucher.trim() ? cents(voucher) : 0;
  const off = manual + credit;
  if (off > gross) throw new Error("O desconto não pode ser maior que o valor do lote.");
  return { original: gross / 100, discount: off / 100, voucher: credit / 100, total: (gross - off) / 100 };
}
