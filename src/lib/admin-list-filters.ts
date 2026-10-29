export const CUSTOMER_ISSUES = {
  all: "Todos os cadastros",
  without_email: "Sem e-mail",
  without_document: "Sem CPF/CNPJ",
  without_name: "Sem nome",
  without_access: "Sem acesso ao painel",
} as const;
export type CustomerIssue = keyof typeof CUSTOMER_ISSUES;

export function adminListHref(path: string, filters: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) if (value !== undefined && value !== "") params.set(name, String(value));
  return path + (params.size ? `?${params}` : "");
}

/** A contagem do dashboard usa lotes do período, não a criação do cliente/Pix. */
export function dashboardPendingLinks(period: { from: string; to: string }, shippingDate?: string) {
  return {
    customers: adminListHref("/admin/clientes", { ...period, issue: "without_email" }),
    lots: adminListHref("/admin/lotes", { ...period, status: "pending_payment" }),
    expiring: adminListHref("/admin/cobrancas", { ...period, expiring: "24h" }),
    shipping: adminListHref("/admin/lotes", { ...period, status: "paid", shipping: shippingDate }),
  };
}

/** Inclui NULL, vazio e espaços, como a contagem do dashboard. */
export function customerIssueExpression(issue: CustomerIssue): string | null {
  const column = issue === "without_email" ? "email" : issue === "without_document" ? "cpf_cnpj" : issue === "without_name" ? "name" : null;
  return column ? `${column}.is.null,${column}.match.^[[:space:]]*$` : null;
}
