/**
 * Cores dos status de lote para gráficos/legendas.
 * `--chart-N` são definidas no globals.css (claro e escuro) e funcionam
 * tanto em componentes de cliente quanto em HTML server-rendered.
 */
export const PIPELINE_COLORS: Record<string, string> = {
  pending_payment: "var(--chart-3)",
  paid: "var(--chart-1)",
  shipped: "var(--chart-2)",
  delivered: "var(--chart-4)",
  cancelled: "var(--chart-5)",
};
