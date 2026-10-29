import "server-only";

import { type LotStatus } from "@/lib/lots";
import { loadNotes } from "@/lib/notes";
import { createAdminClient } from "@/lib/supabase/admin";
import { isChargeActive } from "@/lib/charges";
import { createClient } from "@/lib/supabase/server";

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
  logisticsPending?: { id: string; code: string; title: string; quantity: number; reason: string; moved_at: string | null; shipmentCode?: string | null }[];
  storeOrders?: {id:string;code:string;boxed_at:string|null;fulfillment_status:string;items:{name:string;quantity:number;delivery_kind:string}[]}[];
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

  // Reposições vencidas continuam na fila até entrarem em uma etiqueta.
  // Não são arremates: a conferência não depende de pagamentos do cliente.
  type PendingRow = { id: string; code: string; title: string; quantity: number; reason: string; moved_at: string | null; customers: LotRow["customers"]; shipment?: { code: string } | null };
  const pendingRows: PendingRow[] = [];
  for (let from = 0; ; from += REPORT_LOTS_PAGE_SIZE) {
    const { data, error } = await admin.from("logistics_pending")
      .select("id,code,title,quantity,reason,moved_at,customers(id,name,phone_e164,address_cep,address_street,address_number,address_complement,address_district,address_city,address_state)")
      .lte("shipping_date", shippingDate).is("cancelled_at", null).is("shipment_id", null)
      .order("shipping_date").order("id").range(from, from + REPORT_LOTS_PAGE_SIZE - 1);
    if (error) throw new Error("Não foi possível conferir as pendências logísticas. Confira a migration 0035.");
    const page = (data ?? []) as unknown as PendingRow[];
    pendingRows.push(...page);
    if (page.length < REPORT_LOTS_PAGE_SIZE) break;
  }

  // O histórico de separação mantém as reposições já vinculadas ao pacote
  // desta data, mesmo quando foram originalmente previstas para outro dia.
  for (let from = 0; ; from += REPORT_LOTS_PAGE_SIZE) {
    const { data, error } = await admin.from("logistics_pending")
      .select("id,code,title,quantity,reason,moved_at,shipment:shipments!inner(code,batch_date),customers(id,name,phone_e164,address_cep,address_street,address_number,address_complement,address_district,address_city,address_state)")
      .eq("shipment.batch_date", shippingDate).is("cancelled_at", null)
      .order("id").range(from, from + REPORT_LOTS_PAGE_SIZE - 1);
    if (error) throw new Error("Não foi possível carregar as reposições vinculadas ao envio.");
    const page = (data ?? []) as unknown as PendingRow[];
    pendingRows.push(...page);
    if (page.length < REPORT_LOTS_PAGE_SIZE) break;
  }

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
  if (rows.length === 0 && pendingRows.length === 0) return { shippingDate, customers: [], totals: { customers: 0, lots: 0, excludedCustomers: 0 } };

  const candidateIds = [...new Set(rows.map((row) => row.customers?.id).filter((id): id is string => Boolean(id)))];
  const paymentCandidateIds = candidateIds.length ? candidateIds : ["00000000-0000-0000-0000-000000000000"];
  const { data: pendingLots, error: pendingLotsError } = await admin
    .from("lots").select("customer_id").in("customer_id", paymentCandidateIds).eq("status", "pending_payment");
  if (pendingLotsError) throw new Error(`Falha ao conferir pagamentos pendentes: ${pendingLotsError.message}`);
  const blockedCustomers = new Set((pendingLots ?? []).map((row) => row.customer_id));
  const { data: activeCharges, error: activeChargesError } = await admin.from("charges")
    .select("customer_id, status, expires_at")
    .in("customer_id", paymentCandidateIds)
    .in("status", ["pending", "in_process"]);
  if (activeChargesError) throw new Error(`Falha ao conferir cobranças em aberto: ${activeChargesError.message}`);
  for (const charge of activeCharges ?? []) {
    if (isChargeActive(charge as never)) blockedCustomers.add(charge.customer_id);
  }
  const {data: freightStates,error: freightError}=await admin.rpc('shipping_freight_states',{p_customers:candidateIds});
  if(freightError)throw new Error('Não foi possível conferir os pagamentos de frete.');
  for(const state of freightStates ?? [])if(state.status!=='paid')blockedCustomers.add(state.customer_id);
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

  const db = await createClient();
  for (const row of pendingRows) {
    const customer = row.customers;
    if (!customer) continue;
    const entry: SeparationCustomer = byCustomer.get(customer.id) ?? {
      customerId: customer.id, name: customer.name, phone_e164: customer.phone_e164,
      address: { cep: customer.address_cep, street: customer.address_street, number: customer.address_number,
        complement: customer.address_complement, district: customer.address_district, city: customer.address_city, state: customer.address_state },
      lots: [],
    };
    entry.logisticsPending = [...(entry.logisticsPending ?? []), {
      id: row.id, code: row.code, title: row.title, quantity: row.quantity, reason: row.reason, moved_at: row.moved_at,
      shipmentCode: row.shipment?.code ?? null,
    }];
    byCustomer.set(customer.id, entry);
  }
  const { data: storeRows, error: storeError } = await db.rpc('get_store_fulfillment', { p_day: shippingDate });
  if (storeError) throw new Error('Não foi possível conferir os pedidos da loja para a separação.');
  for (const order of (storeRows ?? []) as (NonNullable<SeparationCustomer['storeOrders']>[number] & {customer_id:string;physical:boolean})[]) {
    const entry = byCustomer.get(order.customer_id);
    if (entry && order.physical) entry.storeOrders = [...(entry.storeOrders ?? []), order];
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
