export const LOT_SORTS = {
  newest: { label: "Cadastro · mais recentes", column: "created_at", ascending: false },
  oldest: { label: "Cadastro · mais antigos", column: "created_at", ascending: true },
  customer_asc: { label: "Cliente · A a Z", column: "customer(name)", ascending: true },
  customer_desc: { label: "Cliente · Z a A", column: "customer(name)", ascending: false },
  phone_asc: { label: "Telefone · crescente", column: "customer(phone_e164)", ascending: true },
  phone_desc: { label: "Telefone · decrescente", column: "customer(phone_e164)", ascending: false },
  value_desc: { label: "Valor · maior primeiro", column: "arremate_value", ascending: false },
  value_asc: { label: "Valor · menor primeiro", column: "arremate_value", ascending: true },
  shipping_asc: { label: "Envio · mais próximos", column: "shipping_date", ascending: true },
  shipping_desc: { label: "Envio · mais distantes", column: "shipping_date", ascending: false },
  title_asc: { label: "Nome do lote · A a Z", column: "title", ascending: true },
  code_asc: { label: "Código do lote · crescente", column: "code", ascending: true },
} as const;

export type LotSort = keyof typeof LOT_SORTS;
export function normalizeLotSort(value: string | undefined): LotSort {
  return value && Object.hasOwn(LOT_SORTS, value) ? value as LotSort : "newest";
}
