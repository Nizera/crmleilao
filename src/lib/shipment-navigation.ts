/** Abrir o histórico não deve herdar o próximo dia de preparação por padrão. */
export function shipmentHistoryHref({ query = "", date = "", status = "all", cost = "all" }: {
  query?: string; date?: string; status?: string; cost?: string;
} = {}): string {
  const params = new URLSearchParams({ vista: "historico" });
  if (query.trim()) params.set("q", query.trim());
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) params.set("d", date);
  if (status !== "all") params.set("status", status);
  if (cost !== "all") params.set("cost", cost);
  return `/admin/envios?${params}`;
}
