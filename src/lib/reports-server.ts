import "server-only";

import { type LotStatus } from "@/lib/lots";
import { loadNotes } from "@/lib/notes";
import { createAdminClient } from "@/lib/supabase/admin";
import { freightPeriodForDate } from "@/lib/freight";
import { isChargeActive } from "@/lib/charges";

/** Lotes por página, abaixo do limite padrão do PostgREST. */
const REPORT_LOTS_PAGE_SIZE = 500;

export type SeparationLot = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  notes: string | null;
  status: LotStatus;
  movedAt: string | null;
  movedItems: string[];
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
    excludedCustomers: number;
  };
};

type LotRow = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  moved_at: string | null;
  auction_date: string;
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

  const rows: LotRow[] = [];
  for (let from = 0; ; from += REPORT_LOTS_PAGE_SIZE) {
    const { data, error } = await admin
      .from("lots")
      .select(
        `id, code, title, description, status, created_at, moved_at, auction_date,
         customers(id, name, phone_e164, address_cep, address_street, address_number, address_complement, address_district, address_city, address_state)`,
      )
      .eq("shipping_date", shippingDate)
      .neq("status", "cancelled")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + REPORT_LOTS_PAGE_SIZE - 1);

    if (error) throw new Error(`Falha ao montar relatório: ${error.message}`);
    const page = (data ?? []) as unknown as LotRow[];
    rows.push(...page);
    if (page.length < REPORT_LOTS_PAGE_SIZE) break;
  }
  if (rows.length === 0) return { shippingDate, customers: [], totals: { customers: 0, lots: 0, excludedCustomers: 0 } };

  const candidateIds = [...new Set(rows.map((row) => row.customers?.id).filter((id): id is string => Boolean(id)))];
  const { data: pendingLots, error: pendingLotsError } = await admin
    .from("lots").select("customer_id").in("customer_id", candidateIds).eq("status", "pending_payment");
  if (pendingLotsError) throw new Error(`Falha ao conferir pagamentos pendentes: ${pendingLotsError.message}`);
  const blockedCustomers = new Set((pendingLots ?? []).map((row) => row.customer_id));
  const { data: activeCharges, error: activeChargesError } = await admin.from("charges")
    .select("customer_id, status, expires_at")
    .in("customer_id", candidateIds)
    .in("status", ["pending", "in_process"]);
  if (activeChargesError) throw new Error(`Falha ao conferir cobranças em aberto: ${activeChargesError.message}`);
  for (const charge of activeCharges ?? []) {
    if (isChargeActive(charge as never)) blockedCustomers.add(charge.customer_id);
  }
  const periods = [...new Set(rows.map((row) => freightPeriodForDate(row.auction_date)))];
  const { data: charges, error: chargesError } = await admin
    .from("charges").select("customer_id, freight_period, freight_amount, status, expires_at")
    .in("customer_id", candidateIds).in("freight_period", periods).gt("freight_amount", 0);
  if (chargesError) throw new Error(`Falha ao conferir cobranças: ${chargesError.message}`);
  const chargeStates = new Map<string, { paid: boolean; active: boolean }>();
  for (const charge of charges ?? []) {
    if (!charge.freight_period) continue;
    const key = `${charge.customer_id}:${charge.freight_period}`;
    const state = chargeStates.get(key) ?? { paid: false, active: false };
    state.paid ||= charge.status === "approved";
    state.active ||= isChargeActive(charge as never);
    chargeStates.set(key, state);
  }
  for (const row of rows) {
    const customerId = row.customers?.id;
    if (!customerId) continue;
    const period = freightPeriodForDate(row.auction_date);
    const state = chargeStates.get(`${customerId}:${period}`);
    if (!state?.paid || state.active) blockedCustomers.add(customerId);
  }
  const eligibleRows = rows.filter((row) => row.customers && !blockedCustomers.has(row.customers.id));
  const itemIds = eligibleRows.map((row) => row.id);
  const itemsByLot = new Map<string, string[]>();
  if (itemIds.length) {
    const { data: items, error: itemsError } = await admin.from("lot_items")
      .select("lot_id, qty, applied, color, player:players(name)").in("lot_id", itemIds);
    if (itemsError) throw new Error(`Falha ao carregar itens movimentados: ${itemsError.message}`);
    for (const item of items ?? []) {
      if (!item.applied) continue;
      const player = item.player as unknown as { name: string } | null;
      const details = `${item.qty} × ${player?.name ?? "Item"} · ${item.color}`;
      itemsByLot.set(item.lot_id, [...(itemsByLot.get(item.lot_id) ?? []), details]);
    }
  }
  const notes = await loadNotes("lot", rows.map((row) => row.id));

  // Agrupa por cliente preservando a ordem de chegada dos lotes.
  const byCustomer = new Map<string, SeparationCustomer>();

  for (const row of eligibleRows) {
    const customer = row.customers;
    if (!customer) continue;

    const lot: SeparationLot = {
      id: row.id,
      code: row.code,
      title: row.title,
      description: row.description,
      notes: notes.get(row.id) ?? null,
      status: row.status,
      movedAt: row.moved_at,
      movedItems: itemsByLot.get(row.id) ?? [],
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
      excludedCustomers: blockedCustomers.size,
    },
  };
}
