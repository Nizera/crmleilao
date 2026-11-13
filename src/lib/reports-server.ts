import "server-only";

import { nextShippingDate, type LotStatus } from "@/lib/lots";
import {spToday} from "@/lib/dates";
import { loadNotes } from "@/lib/notes";
import { createAdminClient } from "@/lib/supabase/admin";
import { isChargeActive } from "@/lib/charges";

/** Lotes por página, abaixo do limite padrão do PostgREST. */
const REPORT_LOTS_PAGE_SIZE = 500;

export type SeparationLot = {
  id: string;
  createdAt: string;
  shippingDate?: string;
  code: string;
  title: string;
  description: string | null;
  notes: string | null;
  status: LotStatus;
  movedAt: string | null;
  movedItems: string[];
  searchItems?: string[];
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
  logisticsPending?: { shippingDate?: string; id: string; code: string; title: string; quantity: number; reason: string; source_kind: string; shipping_declared_value: number; moved_at: string | null; shipmentCode?: string | null }[];
  storeOrders?: {shippingDate?:string;shipping_declared_value?:number|null;id:string;code:string;boxed_at:string|null;fulfillment_status:string;items:{name:string;quantity:number;delivery_kind:string}[]}[];
  customerId: string;
  name: string | null;
  phone_e164: string;
  address: SeparationAddress;
  lots: SeparationLot[];
};

export type SeparationReport = {
  warnings?: string[];
  excludedCustomerIds?: string[];
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
  arremate_value: number | string;
  charge_id: string | null;
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

type ReportStoreRow = NonNullable<SeparationCustomer["storeOrders"]>[number] & {customer_id:string;created_at:string;shippingDate:string};

async function loadReportStoreOrders(): Promise<ReportStoreRow[]> {
  const admin=createAdminClient();
  const result:ReportStoreRow[]=[];
  for(let from=0;;from+=REPORT_LOTS_PAGE_SIZE){
    const {data,error}=await admin.from("store_orders")
      .select("id,code,customer_id,created_at,boxed_at,fulfillment_status,shipping_declared_value,items:store_order_items(name,quantity,delivery_kind)")
      .eq("payment_status","paid").neq("fulfillment_status","fulfilled").is("shipment_id",null)
      .order("created_at").order("id").range(from,from+REPORT_LOTS_PAGE_SIZE-1);
    if(error)throw new Error("Não foi possível conferir os pedidos da loja para a separação.");
    for(const order of data??[])if(order.items?.some(item=>item.delivery_kind==="physical"))result.push({...order,shippingDate:nextShippingDate(spToday())} as ReportStoreRow);
    if((data?.length??0)<REPORT_LOTS_PAGE_SIZE)return result;
  }
}

function uniqueItems<T extends {id:string}>(items:T[]):T[]{return [...new Map(items.map(item=>[item.id,item])).values()];}
function deduplicateCustomers(customers:SeparationCustomer[]):SeparationCustomer[]{
  return customers.map(customer=>({...customer,lots:uniqueItems(customer.lots),logisticsPending:uniqueItems(customer.logisticsPending??[]),storeOrders:uniqueItems(customer.storeOrders??[])}));
}

/**
 * Relatório de separação de um dia de envio: lotes com `shipping_date` na
 * data (cancelados ficam de fora), agrupados por cliente e identificados
 * pelo nome/descrição e pelas observações internas do lote.
 */
export async function getSeparationReport(
  shippingDate: string,
  outstandingOnly = false,
  preloadedStore?: ReportStoreRow[],
): Promise<SeparationReport> {
  if (shippingDate === "all") return getAllSeparationReport();
  const admin = createAdminClient();

  // Uma única consulta pela data prevista do item evita repetir prêmios entre
  // dias ou incluí-los novamente pela data da etiqueta.
  type PendingRow = { shipping_date: string; id: string; code: string; title: string; quantity: number; reason: string; source_kind: string; shipping_declared_value: number; moved_at: string | null; customers: LotRow["customers"]; shipment?: { code: string; status: string } | null };
  const pendingRows: PendingRow[] = [];
  const warnings: string[] = [];
  for (let from = 0; ; from += REPORT_LOTS_PAGE_SIZE) {
    const pendingQuery = admin.from("logistics_pending")
      .select("shipping_date,id,code,title,quantity,reason,source_kind,shipping_declared_value,moved_at,shipment:shipments(code,batch_date,status),customers(id,name,phone_e164,address_cep,address_street,address_number,address_complement,address_district,address_city,address_state)")
      .eq("shipping_date", shippingDate).is("cancelled_at", null)
      .order("shipping_date").order("id").range(from, from + REPORT_LOTS_PAGE_SIZE - 1);
    const { data, error } = await pendingQuery;
    if (error) {
      if (["PGRST205", "42P01"].includes(error.code)) {
        warnings.push("As pendências logísticas não foram carregadas: aplique a migration 0035 no Supabase e atualize a tela. Este relatório contém somente os itens disponíveis; não use para concluir a separação de reposições.");
        break;
      }
      throw new Error("Não foi possível conferir as pendências logísticas. Tente novamente antes de separar os envios.");
    }
    const page = (data ?? []) as unknown as PendingRow[];
    pendingRows.push(...page.filter(row=>!outstandingOnly || !row.shipment || ["pending","released"].includes(row.shipment.status)));
    if (page.length < REPORT_LOTS_PAGE_SIZE) break;
  }

  const rows: LotRow[] = [];
  for (let from = 0; ; from += REPORT_LOTS_PAGE_SIZE) {
    const { data, error } = await admin
      .from("lots")
      .select(
        `id, code, title, description, status, created_at, moved_at, auction_date, arremate_value, charge_id,
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
  const physicalStore = (preloadedStore ?? await loadReportStoreOrders()).filter(order=>order.shippingDate===shippingDate);

  // Um pacote liberado já passou pela conferência: pendências de outra data
  // não podem retirar seu conteúdo da separação nem do histórico impresso.
  const releasedLotIds = new Set<string>();
  const dispatchedLotIds = new Set<string>();
  const releasedPrizeIds = new Set<string>();
  for (let from = 0; from < rows.length; from += 200) {
    const ids = rows.slice(from, from + 200).map(row => row.id);
    const [links, prizes] = await Promise.all([
      admin.from("shipment_lots")
        .select("lot_id,shipment:shipments!inner(batch_date,status)")
        .in("lot_id", ids).eq("shipment.batch_date", shippingDate)
        .in("shipment.status", ["released", "posted", "delivered"]),
      admin.from("external_prize_freight_releases").select("lot_id,customer_id").in("lot_id", ids),
    ]);
    if (links.error || prizes.error) throw new Error("Não foi possível conferir os pacotes e as liberações de frete dos prêmios.");
    for (const link of links.data ?? []) {
      releasedLotIds.add(link.lot_id);
      const shipment = Array.isArray(link.shipment) ? link.shipment[0] : link.shipment;
      if (shipment && ["posted","delivered"].includes(shipment.status)) dispatchedLotIds.add(link.lot_id);
    }
    for (const prize of prizes.data ?? []) {
      const row = rows.slice(from, from + 200).find(lot => lot.id === prize.lot_id);
      if (row && row.customers?.id === prize.customer_id && Number(row.arremate_value) === 0) releasedPrizeIds.add(prize.lot_id);
    }
  }

  const candidateIds = [...new Set([...rows.map((row) => row.customers?.id).filter((id): id is string => Boolean(id)),...physicalStore.map(o=>o.customer_id)])];
  const paymentBlockedCustomers=new Set<string>();
  const freightBlockedCustomers=new Set<string>();
  const blockedCustomers=new Set<string>();
  for(let from=0;from<candidateIds.length;from+=100){
   const ids=candidateIds.slice(from,from+100);
   const [pending,freights,storePending]=await Promise.all([
    admin.from('lots').select('customer_id,charge_id').in('customer_id',ids).eq('status','pending_payment').lte('shipping_date',shippingDate),
    admin.rpc('shipping_freight_states',{p_customers:ids}),
    admin.from('store_orders').select('customer_id,items:store_order_items(delivery_kind)').in('customer_id',ids).in('payment_status',['creating','pending','partially_refunded','payment_review']).is('shipment_id',null).lt('created_at',`${shippingDate}T23:59:59.999999-03:00`),
   ]);
   if(pending.error||freights.error||storePending.error)throw new Error('Não foi possível conferir os pagamentos e fretes da separação.');
   // Só cobranças relacionadas aos lotes deste envio ou a pendências vencidas.
   const chargeIds=[...new Set([
     ...rows.filter(row=>row.customers && ids.includes(row.customers.id)).map(row=>row.charge_id),
     ...(pending.data??[]).map(row=>row.charge_id),
   ].filter((id):id is string=>Boolean(id)))];
   for(let offset=0;offset<chargeIds.length;offset+=100){
     const charges=await admin.from('charges').select('customer_id,status,expires_at')
       .in('customer_id',ids).in('id',chargeIds.slice(offset,offset+100)).in('status',['pending','in_process']);
     if(charges.error)throw new Error('Não foi possível conferir as cobranças do envio selecionado.');
     for(const row of charges.data??[])if(isChargeActive(row as never))paymentBlockedCustomers.add(row.customer_id);
   }
   for(const row of pending.data??[])paymentBlockedCustomers.add(row.customer_id);
   for(const row of freights.data??[])if(row.status!=='paid')freightBlockedCustomers.add(row.customer_id);
   for(const row of storePending.data??[])if(row.items.some(i=>i.delivery_kind==='physical'))paymentBlockedCustomers.add(row.customer_id);
  }
  for(const id of candidateIds)if(paymentBlockedCustomers.has(id)||freightBlockedCustomers.has(id))blockedCustomers.add(id);
  const eligibleRows = rows.filter(row => {
    if (!row.customers || !["paid", "shipped", "delivered"].includes(row.status)) return false;
    if (outstandingOnly && (dispatchedLotIds.has(row.id) || row.status !== "paid")) return false;
    if (releasedLotIds.has(row.id)) return true;
    return !paymentBlockedCustomers.has(row.customers.id)
      && (!freightBlockedCustomers.has(row.customers.id) || releasedPrizeIds.has(row.id));
  });
  const itemIds = eligibleRows.map((row) => row.id);
  const itemsByLot = new Map<string, string[]>();
  const searchableItemsByLot = new Map<string,string[]>();
  for(let from=0;from<itemIds.length;from+=200) {
    const { data: items, error: itemsError } = await admin.from("lot_items")
      .select("lot_id, qty, applied, color, player:players(name)").in("lot_id", itemIds.slice(from,from+200));
    if (itemsError) throw new Error(`Falha ao carregar itens movimentados: ${itemsError.message}`);
    for (const item of items ?? []) {
      const player = item.player as unknown as { name: string } | null;
      const details = `${item.qty} × ${player?.name ?? "Item"} · ${item.color}`;
      searchableItemsByLot.set(item.lot_id,[...(searchableItemsByLot.get(item.lot_id)??[]),details]);
      if (!item.applied) continue;
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
      searchItems: searchableItemsByLot.get(row.id) ?? [],
      createdAt: row.created_at,
      shippingDate,
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
      shippingDate: row.shipping_date, id: row.id, code: row.code, title: row.title, quantity: row.quantity, reason: row.reason, source_kind: row.source_kind, shipping_declared_value: Number(row.shipping_declared_value), moved_at: row.moved_at,
      shipmentCode: row.shipment?.code ?? null,
    }];
    byCustomer.set(customer.id, entry);
  }
  const missingStoreCustomers=[...new Set(physicalStore.filter(o=>!byCustomer.has(o.customer_id)&&!blockedCustomers.has(o.customer_id)).map(o=>o.customer_id))];
  for(let from=0;from<missingStoreCustomers.length;from+=100){
   const {data,error}=await admin.from('customers').select('id,name,phone_e164,address_cep,address_street,address_number,address_complement,address_district,address_city,address_state').in('id',missingStoreCustomers.slice(from,from+100));
   if(error)throw new Error('Não foi possível carregar os destinatários dos pedidos da loja.');
   for(const c of data??[])byCustomer.set(c.id,{customerId:c.id,name:c.name,phone_e164:c.phone_e164,address:{cep:c.address_cep,street:c.address_street,number:c.address_number,complement:c.address_complement,district:c.address_district,city:c.address_city,state:c.address_state},lots:[]});
  }
  for(const order of physicalStore){if(blockedCustomers.has(order.customer_id))continue;const entry=byCustomer.get(order.customer_id);if(entry)entry.storeOrders=[...(entry.storeOrders??[]),order];}

  // Alfabético: no papel lê-se cliente por cliente; sem nome vai para o fim.
  const customers = deduplicateCustomers([...byCustomer.values()]).sort((a, b) => {
    const left = a.name?.trim() || null;
    const right = b.name?.trim() || null;
    if (!left && !right) return 0;
    if (!left) return 1;
    if (!right) return -1;
    return left.localeCompare(right, "pt-BR", { sensitivity: "base" });
  });

  return {
    shippingDate,
    excludedCustomerIds: candidateIds.filter(id => !byCustomer.has(id)),
    warnings,
    customers,
    totals: {
      customers: customers.length,
      lots: customers.reduce((sum, customer) => sum + customer.lots.length, 0),
      excludedCustomers: candidateIds.filter(id => !byCustomer.has(id)).length,
    },
  };
}

/** Visão geral: reutiliza a conferência financeira de cada remessa, sem permitir
 * que débitos de uma remessa futura bloqueiem os itens de uma data anterior. */
async function getAllSeparationReport(): Promise<SeparationReport> {
  const admin = createAdminClient();
  const dates = new Set<string>();
  for (const table of ["lots", "logistics_pending"] as const) {
    for (let from = 0; ; from += REPORT_LOTS_PAGE_SIZE) {
      let query = admin.from(table).select("shipping_date");
      query = table === "lots" ? query.in("status", ["paid", "pending_payment"]) : query.is("cancelled_at", null);
      const {data,error} = await query.order("shipping_date").order("id").range(from, from + REPORT_LOTS_PAGE_SIZE - 1);
      if (error) throw new Error("Não foi possível carregar todas as datas de separação.");
      for (const row of data ?? []) if (row.shipping_date) dates.add(row.shipping_date);
      if ((data ?? []).length < REPORT_LOTS_PAGE_SIZE) break;
    }
  }
  const storeOrders=await loadReportStoreOrders();
  for(const order of storeOrders)dates.add(order.shippingDate);
  // Também contempla compras da loja sem lotes ou prêmios associados.
  dates.add(spToday());
  const customers = new Map<string, SeparationCustomer>();
  const warnings = new Set<string>();
  const excludedIds = new Set<string>();
  for (const day of [...dates].sort()) {
    const report = await getSeparationReport(day, true, storeOrders);
    for (const id of report.excludedCustomerIds ?? []) excludedIds.add(id);
    for (const warning of report.warnings ?? []) warnings.add(warning);
    for (const customer of report.customers) {
      const previous = customers.get(customer.customerId);
      if (!previous) { customers.set(customer.customerId, customer); continue; }
      previous.lots = [...new Map([...previous.lots,...customer.lots].map(item => [item.id,item])).values()];
      previous.logisticsPending = [...new Map([...(previous.logisticsPending??[]),...(customer.logisticsPending??[])].map(item=>[item.id,item])).values()];
      previous.storeOrders = [...new Map([...(previous.storeOrders??[]),...(customer.storeOrders??[])].map(item=>[item.id,item])).values()];
    }
  }
  const rows = deduplicateCustomers([...customers.values()]).filter(c=>c.lots.length || c.logisticsPending?.length || c.storeOrders?.length)
    .sort((a,b)=>(a.name??"ZZZ").localeCompare(b.name??"ZZZ","pt-BR"));
  return {shippingDate:"all",warnings:[...warnings],customers:rows,totals:{customers:rows.length,lots:rows.reduce((n,c)=>n+c.lots.length,0),excludedCustomers:[...excludedIds].filter(id=>!customers.has(id)).length}};
}
