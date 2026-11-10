import { isValidBrazilianDocument } from "./brazilian-document";

export type ShipmentRecipient = {
  name?: string | null; email?: string | null; cpf_cnpj?: string | null;
  address_cep?: string | null; address_street?: string | null;
  address_district?: string | null; address_city?: string | null; address_state?: string | null;
};

/** Somente nomes dos campos; nunca expõe documento ou endereço nos alertas. */
export function recipientIssues(customer: ShipmentRecipient): string[] {
  const issues: string[] = [];
  const name = customer.name?.trim() ?? "";
  if (name.split(/\s+/).filter(Boolean).length < 2) issues.push("nome completo (nome e sobrenome)");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email?.trim() ?? "")) issues.push("e-mail válido");
  if (!isValidBrazilianDocument(customer.cpf_cnpj ?? "")) issues.push("CPF ou CNPJ válido");
  const cep = (customer.address_cep ?? "").replace(/[\s.-]/g, "");
  if (!/^\d{8}$/.test(cep) || cep === "00000000") issues.push("CEP válido (8 dígitos)");
  if (!customer.address_street?.trim()) issues.push("rua");
  if (!customer.address_district?.trim()) issues.push("bairro");
  if (!customer.address_city?.trim()) issues.push("cidade");
  if (!/^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/.test(customer.address_state?.trim().toUpperCase() ?? "")) issues.push("UF válida");
  return issues;
}

export function shipmentQueueIssues(row: {
  recipientIssues?: string[]; blockingUnpaidTotal?: number; unpaidTotal: number;
  blockingUnpaidCount?: number;
  hasActiveCharge: boolean; companyFreight?: boolean; freightStatus: string;
}): string[] {
  const issues = [...(row.recipientIssues ?? []).map(field => `Cadastro: ${field}.`)];
  if ((row.blockingUnpaidCount ?? 0) > 0 || (row.blockingUnpaidTotal ?? row.unpaidTotal) > 0) issues.push("Há lotes não pagos nesta data de envio.");
  if (row.hasActiveCharge) issues.push("Há Pix aguardando confirmação para esta data de envio.");
  if (!row.companyFreight && row.freightStatus !== "paid") issues.push(row.freightStatus === "awaiting" ? "O pagamento do frete aguarda confirmação." : "O frete precisa estar pago ou liberado pela equipe.");
  return issues;
}
