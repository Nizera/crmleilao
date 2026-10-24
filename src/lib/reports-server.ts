import "server-only";

import { type LotStatus } from "@/lib/lots";
import { loadNotes } from "@/lib/notes";
import { createAdminClient } from "@/lib/supabase/admin";

/** Teto de lotes lidos por relatório — igual à fila de envios. */
const REPORT_LOTS_CAP = 1000;

export type SeparationLot = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  notes: string | null;
  status: LotStatus;
};

export type SeparationAddress = {
  cep: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
};

export type SeparationCustomer = {
  customerId: string;
  name: string | null;
  phone_e164: string;
  address: SeparationAddress;
  lots: SeparationLot[];
};

export type SeparationReport = {
  shippingDate: string;
  customers: SeparationCustomer[];
  totals: {
    customers: number;
    lots: number;
  };
};

type LotRow = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  status: LotStatus;
  created_at: string;
  customers: {
    id: string;
    name: string | null;
    phone_e164: string;
    address_cep: string | null;
    address_street: string | null;
    address_number: string | null;
    address_complement: string | null;
    address_district: string | null;
    address_city: string | null;
    address_state: string | null;
  } | null;
};

/**
 * Relatório de separação de um dia de envio: lotes com `shipping_date` na
 * data (cancelados ficam de fora), agrupados por cliente e identificados
 * pelo nome/descrição e pelas observações internas do lote.
 */
export async function getSeparationReport(
  shippingDate: string,
): Promise<SeparationReport> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("lots")
    .select(
      `id, code, title, description, status, created_at,
       customers(id, name, phone_e164, address_cep, address_street, address_number, address_complement, address_district, address_city, address_state)`,
    )
    .eq("shipping_date", shippingDate)
    .neq("status", "cancelled")
    .order("created_at", { ascending: true })
    .limit(REPORT_LOTS_CAP + 1);

  if (error) throw new Error(`Falha ao montar relatório: ${error.message}`);

  const rows = ((data ?? []) as unknown as LotRow[]).slice(0, REPORT_LOTS_CAP);
  const notes = await loadNotes("lot", rows.map((row) => row.id));

  // Agrupa por cliente preservando a ordem de chegada dos lotes.
  const byCustomer = new Map<string, SeparationCustomer>();

  for (const row of rows) {
    const customer = row.customers;
    if (!customer) continue;

    const lot: SeparationLot = {
      id: row.id,
      code: row.code,
      title: row.title,
      description: row.description,
      notes: notes.get(row.id) ?? null,
      status: row.status,
    };

    const entry = byCustomer.get(customer.id) ?? {
      customerId: customer.id,
      name: customer.name,
      phone_e164: customer.phone_e164,
      address: {
        cep: customer.address_cep,
        street: customer.address_street,
        number: customer.address_number,
        complement: customer.address_complement,
        district: customer.address_district,
        city: customer.address_city,
        state: customer.address_state,
      },
      lots: [],
    };

    entry.lots.push(lot);
    byCustomer.set(customer.id, entry);
  }

  // Alfabético: no papel lê-se cliente por cliente; sem nome vai para o fim.
  const customers = [...byCustomer.values()].sort((a, b) => {
    const left = a.name?.trim() || null;
    const right = b.name?.trim() || null;
    if (!left && !right) return 0;
    if (!left) return 1;
    if (!right) return -1;
    return left.localeCompare(right, "pt-BR", { sensitivity: "base" });
  });

  return {
    shippingDate,
    customers,
    totals: {
      customers: customers.length,
      lots: customers.reduce((sum, customer) => sum + customer.lots.length, 0),
    },
  };
}
