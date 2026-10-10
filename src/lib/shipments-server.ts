import "server-only";

import {
  cancelOrder,
  checkoutOrders,
  createCart,
  createWebhookApp,
  fallbackTrackingUrl,
  getOrderInfo,
  normalizeSfStatus,
  sfWebhookUrl,
  sfServiceLabel,
  tagPrintUrl,
  type SfOrderInfo,
  type SfParty,
  type SfVolume,
} from "@/lib/superfrete";
import type {
  Shipment,
  ShipmentStatus,
  ShipmentVolume,
} from "@/lib/shipments";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Núcleo dos envios SuperFrete (F4) — server-only.
 * Tudo aqui usa service role: as actions validam os guards (admin) antes e o
 * webhook não tem sessão.
 */

export const SHIPMENT_COLUMNS = [
  "id, code, customer_id, batch_date, status, service_id, service_name, carrier,",
  "price, discount, delivery_time, insurance_value, volume, address, sf_order_id,",
  "tracking_code, tracking_url, label_print_url, paid_at, posted_at, delivered_at,",
  "cancelled_at, notes, events, created_by, created_at, updated_at,",
  "customer:customers(id, name, phone_e164)",
].join(" ");

export type TransitionResult = { ok: boolean; reason?: string };

/** Histórico de eventos do webhook guardado em `events` (depuração). */
type ShipmentEvent = { event: string; received_at: string; detail?: unknown };

/* -------------------------------------------------------------------------- */
/*  Consultas básicas                                                          */
/* -------------------------------------------------------------------------- */

/** Liga os lotes (via shipment_lots) a cada envio da lista. */
export async function attachLots<T extends { id: string; lots?: unknown }>(
  rows: T[],
): Promise<(T & { lots: { id: string; code: string; title: string }[] })[]> {
  if (rows.length === 0) return rows as never;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("shipment_lots")
    .select("shipment_id, lots(id, code, title)")
    .in(
      "shipment_id",
      rows.map((row) => row.id),
    );

  if (error) throw new Error(`Falha ao listar lotes do envio: ${error.message}`);

  type LinkRow = {
    shipment_id: string;
    lots: { id: string; code: string; title: string } | null;
  };
  const byShipment = new Map<string, { id: string; code: string; title: string }[]>();
  for (const link of (data ?? []) as unknown as LinkRow[]) {
    if (!link.lots) continue;
    const list = byShipment.get(link.shipment_id) ?? [];
    list.push(link.lots);
    byShipment.set(link.shipment_id, list);
  }

  return rows.map((row) => ({
    ...row,
    lots: byShipment.get(row.id) ?? [],
  })) as never;
}

export async function getShipmentById(id: string): Promise<Shipment | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("shipments")
    .select(SHIPMENT_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Falha ao carregar envio: ${error.message}`);
  if (!data) return null;

  const [withLots] = await attachLots([data as unknown as Shipment]);
  return withLots ?? null;
}

export async function getShipmentBySfId(
  sfOrderId: string,
): Promise<Shipment | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("shipments")
    .select(SHIPMENT_COLUMNS)
    .eq("sf_order_id", sfOrderId)
    .maybeSingle();

  if (error) throw new Error(`Falha ao carregar envio: ${error.message}`);
  return (data as unknown as Shipment) ?? null;
}

export type EligibleShipmentLot = {
  id: string;
  code: string;
  title: string;
  arremate_value: number;
  shipping_date: string | null;
};

/** Lotes `paid` do cliente que ainda não estão em nenhum envio ativo. */
export async function listEligibleShipmentLots(
  customerId: string,
): Promise<EligibleShipmentLot[]> {
  const admin = createAdminClient();

  const { data: lots, error } = await admin
    .from("lots")
    .select("id, code, title, arremate_value, shipping_date, status")
    .eq("customer_id", customerId)
    .eq("status", "paid")
    .order("auction_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Falha ao listar lotes: ${error.message}`);
  if (!lots || lots.length === 0) return [];

  const { data: active, error: activeError } = await admin
    .from("shipments")
    .select("id")
    .neq("status", "cancelled");
  if (activeError) {
    throw new Error(`Falha ao listar envios: ${activeError.message}`);
  }

  const busy = new Set<string>();
  const activeIds = (active ?? []).map((row) => row.id);
  if (activeIds.length > 0) {
    const { data: links, error: linksError } = await admin
      .from("shipment_lots")
      .select("lot_id")
      .in("shipment_id", activeIds);
    if (linksError) {
      throw new Error(`Falha ao listar vínculos: ${linksError.message}`);
    }
    for (const link of links ?? []) busy.add(link.lot_id);
  }

  return (lots as EligibleShipmentLot[]).filter((lot) => !busy.has(lot.id));
}

/* -------------------------------------------------------------------------- */
/*  Origem e segredo do webhook                                                */
/* -------------------------------------------------------------------------- */

export type OriginAddress = {
  name: string;
  address: string;
  number: string;
  district: string;
  city: string;
  state_abbr: string;
  postal_code: string;
};

/** Endereço de origem completo, ou null se faltar algo (migração 0006/config). */
export async function getOrigin(): Promise<OriginAddress | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("app_settings")
    .select(
      "origin_name, origin_address, origin_number, origin_district, origin_city, origin_state, origin_cep",
    )
    .eq("id", true)
    .maybeSingle();

  if (!data) return null;

  const name = data.origin_name?.trim();
  const address = data.origin_address?.trim();
  const district = data.origin_district?.trim();
  const city = data.origin_city?.trim();
  const state = data.origin_state?.trim();
  const cep = data.origin_cep?.replace(/\D/g, "");

  if (!name || !address || !district || !city || !state || !cep) return null;
  if (cep.length !== 8 || state.length !== 2) return null;

  return {
    name,
    address,
    number: data.origin_number?.trim() || "S/N",
    district,
    city,
    state_abbr: state.toUpperCase(),
    postal_code: cep,
  };
}

/** secret_token do webhook SuperFrete (null = ainda não ativado). */
export async function getWebhookSecret(): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("app_settings")
    .select("superfrete_webhook_secret")
    .eq("id", true)
    .maybeSingle();
  return data?.superfrete_webhook_secret?.trim() || null;
}

/** Cadastra o webhook (uma vez) e grava o secret em app_settings. */
export async function ensureSuperfreteWebhook(): Promise<{ created: boolean }> {
  const existing = await getWebhookSecret();
  if (existing) return { created: false };

  const { secretToken } = await createWebhookApp({
    name: "CarasLegendsCRM",
    url: sfWebhookUrl(),
  });

  const admin = createAdminClient();
  const { error } = await admin
    .from("app_settings")
    .update({ superfrete_webhook_secret: secretToken })
    .eq("id", true);

  if (error) {
    throw new Error(
      `Webhook criado na SuperFrete, mas não foi possível gravar o segredo: ${error.message}. ` +
        "Aplique a migração 0006_shipments.sql e ative de novo.",
    );
  }

  return { created: true };
}

/* -------------------------------------------------------------------------- */
/*  Endereço do destinatário                                                   */
/* -------------------------------------------------------------------------- */

type CustomerRow = {
  id: string;
  name: string | null;
  email: string | null;
  cpf_cnpj: string | null;
  phone_e164: string;
  address_cep: string | null;
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  address_district: string | null;
  address_city: string | null;
  address_state: string | null;
};

/** Telefone só quando resultar em 11 dígitos (exigência de algumas transportadoras). */
function normalizePhone(phoneE164: string): string | null {
  let digits = phoneE164.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length > 11) digits = digits.slice(2);
  return digits.length === 11 ? digits : null;
}

/** Campos obrigatórios do destinatário que faltam na ficha do cliente. */
export function missingRecipientFields(customer: CustomerRow): string[] {
  const missing: string[] = [];
  if (!customer.name?.trim()) missing.push("nome completo");
  if (!customer.email?.trim()) missing.push("e-mail");
  const document = (customer.cpf_cnpj ?? "").replace(/\D/g, "");
  if (document.length !== 11 && document.length !== 14) {
    missing.push("CPF ou CNPJ");
  }
  if (!customer.address_cep) missing.push("CEP");
  if (!customer.address_street) missing.push("rua");
  if (!customer.address_district) missing.push("bairro");
  if (!customer.address_city) missing.push("cidade");
  if (!customer.address_state) missing.push("UF");
  return missing;
}

function buildRecipient(customer: CustomerRow): SfParty {
  const document = (customer.cpf_cnpj ?? "").replace(/\D/g, "");
  return {
    name: customer.name!.trim().slice(0, 50),
    address: customer.address_street!.trim().slice(0, 50),
    number: customer.address_number?.trim() || "S/N",
    complement: customer.address_complement?.trim() || undefined,
    district: customer.address_district!.trim().slice(0, 60),
    city: customer.address_city!.trim().slice(0, 50),
    state_abbr: customer.address_state!.toUpperCase(),
    postal_code: customer.address_cep!,
    email: customer.email!.trim(),
    phone: normalizePhone(customer.phone_e164),
    document,
  };
}

async function loadCustomer(customerId: string): Promise<CustomerRow> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("customers")
    .select(
      "id, name, email, cpf_cnpj, phone_e164, address_cep, address_street, address_number, address_complement, address_district, address_city, address_state",
    )
    .eq("id", customerId)
    .maybeSingle();

  if (error) throw new Error(`Falha ao carregar cliente: ${error.message}`);
  if (!data) throw new Error("Cliente não encontrado.");
  return data as CustomerRow;
}

/* -------------------------------------------------------------------------- */
/*  Transições de status                                                       */
/* -------------------------------------------------------------------------- */

const STATUS_RANK: Record<ShipmentStatus, number> = {
  pending: 0,
  released: 1,
  posted: 2,
  delivered: 3,
  cancelled: -1,
};

/**
 * Aplica o status de forma monotônica e idempotente:
 *  - não retrocede (posted → released é ignorado);
 *  - cancelled só sai de pending/released (regra da SuperFrete);
 *  - `pending → released` marca os lotes etc. nos efeitos abaixo.
 */
async function applyStatusChange(
  shipment: Shipment,
  target: ShipmentStatus,
  patch: Record<string, unknown>,
): Promise<TransitionResult> {
  const current = shipment.status;
  const allowed =
    target === "cancelled"
      ? current === "pending" || current === "released"
      : current !== "cancelled" && STATUS_RANK[target] >= STATUS_RANK[current];

  if (!allowed) {
    return { ok: false, reason: `already_${current}` };
  }

  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from("shipments")
    .update({ ...patch, status: target })
    .eq("id", shipment.id)
    .eq("status", current)
    .select("id");

  if (error) throw new Error(`Falha ao atualizar envio: ${error.message}`);
  if (!updated || updated.length === 0) {
    return { ok: false, reason: "concurrent" };
  }

  if (target !== current) {
    await applyLotEffects(shipment.id, target);
  }

  return { ok: true };
}

/** Sincroniza o status dos lotes do pacote com o status do envio. */
async function applyLotEffects(
  shipmentId: string,
  target: ShipmentStatus,
): Promise<void> {
  const admin = createAdminClient();

  const { data: links, error } = await admin
    .from("shipment_lots")
    .select("lot_id")
    .eq("shipment_id", shipmentId);
  if (error) throw new Error(`Falha ao listar lotes do envio: ${error.message}`);
  const lotIds = (links ?? []).map((link) => link.lot_id);
  if (lotIds.length === 0) return;

  if (target === "posted") {
    const { error: lotsError } = await admin
      .from("lots")
      .update({ status: "shipped", shipped_at: new Date().toISOString() })
      .in("id", lotIds)
      .eq("status", "paid");
    if (lotsError) {
      throw new Error(`Falha ao marcar lotes como enviados: ${lotsError.message}`);
    }
  } else if (target === "delivered") {
    const { error: lotsError } = await admin
      .from("lots")
      .update({ status: "delivered" })
      .in("id", lotIds)
      .eq("status", "shipped");
    if (lotsError) {
      throw new Error(`Falha ao marcar lotes como entregues: ${lotsError.message}`);
    }
  } else if (target === "cancelled") {
    const { error: lotsError } = await admin
      .from("lots")
      .update({ status: "paid", shipped_at: null })
      .in("id", lotIds)
      .eq("status", "shipped");
    if (lotsError) {
      throw new Error(`Falha ao devolver os lotes: ${lotsError.message}`);
    }
  }
}

/** Guarda os dados da etiqueta vindos de order/info (status, PDF, rastreio). */
async function applyOrderInfo(
  shipment: Shipment,
  info: SfOrderInfo,
): Promise<TransitionResult> {
  const target = normalizeSfStatus(info.status);
  const patch: Record<string, unknown> = {
    price: info.price ?? shipment.price,
    discount: info.discount ?? shipment.discount,
    ...(info.service_id != null ? { service_id: info.service_id } : {}),
    ...(info.print?.url ? { label_print_url: info.print.url } : {}),
    ...(info.tracking
      ? {
          tracking_code: info.tracking,
          tracking_url: shipment.tracking_url || fallbackTrackingUrl(info.tracking),
        }
      : {}),
  };

  if (info.paid_at && !shipment.paid_at) patch.paid_at = info.paid_at;
  if (info.posted_at && !shipment.posted_at) patch.posted_at = info.posted_at;

  if (!target) {
    const admin = createAdminClient();
    const { error } = await admin
      .from("shipments")
      .update(patch)
      .eq("id", shipment.id);
    if (error) throw new Error(`Falha ao atualizar envio: ${error.message}`);
    return { ok: true };
  }

  if (target === "cancelled") patch.cancelled_at = shipment.cancelled_at ?? new Date().toISOString();
  if (target === "posted" && !shipment.posted_at) patch.posted_at = new Date().toISOString();
  if (target === "delivered" && !shipment.delivered_at) {
    patch.delivered_at = new Date().toISOString();
  }

  return applyStatusChange(shipment, target, patch);
}

/* -------------------------------------------------------------------------- */
/*  Ações de emissão                                                           */
/* -------------------------------------------------------------------------- */

export async function emitShipment(input: {
  customerId: string;
  lotIds: string[];
  serviceId: number;
  volume: ShipmentVolume;
  batchDate?: string | null;
  createdBy: string | null;
}): Promise<{ shipment: Shipment; warning?: string }> {
  const admin = createAdminClient();

  const origin = await getOrigin();
  if (!origin) {
    throw new Error(
      "Endereço de origem incompleto. Preencha em Configuração → Endereço de origem (envios).",
    );
  }

  const customer = await loadCustomer(input.customerId);
  const missing = missingRecipientFields(customer);
  if (missing.length > 0) {
    throw new Error(
      `Faltam dados do destinatário: ${missing.join(", ")}. Preencha na ficha do cliente.`,
    );
  }

  const eligible = await listEligibleShipmentLots(input.customerId);
  const picked = eligible.filter((lot) => input.lotIds.includes(lot.id));
  if (picked.length === 0) {
    throw new Error(
      "Nenhum dos lotes selecionados está pago e disponível para envio.",
    );
  }

  const insuranceValue = Math.round(
    picked.reduce((sum, lot) => sum + Number(lot.arremate_value), 0) * 100,
  ) / 100;

  const products = picked.map((lot) => ({
    name: `Lote ${lot.code} — ${lot.title}`.slice(0, 60),
    quantity: 1,
    unitary_value: Number(lot.arremate_value),
  }));

  // 1) Etiqueta na SuperFrete (status pending).
  const cart = await createCart({
    from: origin,
    to: buildRecipient(customer),
    service: input.serviceId,
    products,
    volume: input.volume as SfVolume,
    insuranceValue,
  });

  // 2) Registro local. Se falhar, cancela a etiqueta órfã (best effort).
  const { data: inserted, error: insertError } = await admin
    .from("shipments")
    .insert({
      customer_id: input.customerId,
      ...(input.batchDate ? { batch_date: input.batchDate } : {}),
      status: "pending",
      service_id: input.serviceId,
      service_name: sfServiceLabel(input.serviceId),
      carrier: null,
      price: cart.price,
      insurance_value: insuranceValue,
      volume: input.volume,
      address: buildRecipient(customer),
      sf_order_id: cart.id,
      created_by: input.createdBy,
    })
    .select("id")
    .single();

  if (insertError) {
    await cancelOrder(cart.id, "Falha ao registrar o envio no CRM").catch(() => null);
    throw new Error(`Falha ao registrar o envio: ${insertError.message}`);
  }

  const shipmentId = inserted.id as string;

  const { error: linkError } = await admin.from("shipment_lots").insert(
    picked.map((lot) => ({ shipment_id: shipmentId, lot_id: lot.id })),
  );
  if (linkError) {
    await cancelOrder(cart.id, "Falha ao vincular os lotes no CRM").catch(() => null);
    try {
      await admin.from("shipments").delete().eq("id", shipmentId);
    } catch {
      /* best effort */
    }
    throw new Error(`Falha ao vincular os lotes: ${linkError.message}`);
  }

  // 3) Pagamento com o saldo da carteira — pode falhar (sem saldo).
  let warning: string | undefined;
  try {
    await checkoutOrders([cart.id]);
    const info = await getOrderInfo(cart.id);
    const shipment = await getShipmentById(shipmentId);
    if (shipment) await applyOrderInfo(shipment, info);
  } catch (error) {
    warning =
      `Etiqueta criada, mas o pagamento falhou: ${
        error instanceof Error ? error.message : "erro desconhecido"
      } Recarregue a carteira da SuperFrete e use “Pagar etiqueta”.`;
  }

  const shipment = await getShipmentById(shipmentId);
  if (!shipment) throw new Error("Envio criado, mas não foi possível recarregá-lo.");
  return { shipment, warning };
}

export async function payShipment(id: string): Promise<Shipment> {
  const shipment = await getShipmentById(id);
  if (!shipment) throw new Error("Envio não encontrado.");
  if (shipment.status !== "pending") {
    throw new Error("Este envio não está aguardando pagamento.");
  }

  try {
    await checkoutOrders([shipment.sf_order_id]);
    const info = await getOrderInfo(shipment.sf_order_id);
    await applyOrderInfo(shipment, info);
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : "Falha ao pagar a etiqueta."} ` +
        "Confira o saldo da carteira em web.superfrete.com.",
    );
  }

  const updated = await getShipmentById(id);
  if (!updated) throw new Error("Envio não encontrado após pagamento.");
  return updated;
}

export async function syncShipment(id: string): Promise<Shipment> {
  const shipment = await getShipmentById(id);
  if (!shipment) throw new Error("Envio não encontrado.");

  const info = await getOrderInfo(shipment.sf_order_id);
  await applyOrderInfo(shipment, info);

  const updated = await getShipmentById(id);
  if (!updated) throw new Error("Envio não encontrado após sincronizar.");
  return updated;
}

export async function cancelShipment(id: string): Promise<Shipment> {
  const shipment = await getShipmentById(id);
  if (!shipment) throw new Error("Envio não encontrado.");
  if (shipment.status !== "pending" && shipment.status !== "released") {
    throw new Error("Só é possível cancelar antes da postagem.");
  }

  await cancelOrder(shipment.sf_order_id, "Cancelado pelo CRM CarasLegends");

  const result = await applyStatusChange(shipment, "cancelled", {
    cancelled_at: new Date().toISOString(),
  });
  if (!result.ok && result.reason !== `already_${shipment.status}`) {
    throw new Error("Etiqueta cancelada na SuperFrete, mas o status local não mudou.");
  }

  const updated = await getShipmentById(id);
  if (!updated) throw new Error("Envio não encontrado após cancelamento.");
  return updated;
}

/** (Re)busca o link do PDF da etiqueta. */
export async function refreshPrintUrl(id: string): Promise<{ url: string }> {
  const shipment = await getShipmentById(id);
  if (!shipment) throw new Error("Envio não encontrado.");

  const url = await tagPrintUrl(shipment.sf_order_id);

  const admin = createAdminClient();
  const { error } = await admin
    .from("shipments")
    .update({ label_print_url: url })
    .eq("id", id);
  if (error) throw new Error(`Falha ao salvar o link da etiqueta: ${error.message}`);

  return { url };
}

/* -------------------------------------------------------------------------- */
/*  Webhook                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Aplica um evento do webhook SuperFrete. Idempotente: eventos repetidos ou
 * fora de ordem só acrescentam dados ao histórico, sem regredir status.
 */
export async function applySuperfreteEvent(input: {
  sfOrderId: string;
  event: string;
  data: Record<string, unknown>;
}): Promise<TransitionResult> {
  const shipment = await getShipmentBySfId(input.sfOrderId);
  if (!shipment) return { ok: false, reason: "not_found" };

  const now = new Date().toISOString();
  const events = ((shipment as unknown as { events?: ShipmentEvent[] }).events ??
    []) as ShipmentEvent[];

  const targetByEvent: Record<string, ShipmentStatus> = {
    "order.created": "pending",
    "order.released": "released",
    "order.generated": "released",
    "order.posted": "posted",
    "order.delivered": "delivered",
    "order.cancelled": "cancelled",
  };
  const target = targetByEvent[input.event];
  if (!target) return { ok: true, reason: "ignored" };

  const str = (key: string) => {
    const value = input.data[key];
    return typeof value === "string" && value ? value : null;
  };

  const tracking = str("tracking");
  const trackingUrl =
    str("tracking_url") ??
    (tracking ? fallbackTrackingUrl(tracking) : null) ??
    shipment.tracking_url;

  const patch: Record<string, unknown> = {
    events: [...events, { event: input.event, received_at: now }].slice(-50),
  };
  if (tracking) patch.tracking_code = tracking;
  if (trackingUrl) patch.tracking_url = trackingUrl;
  if (target === "released") {
    patch.paid_at = str("paid_at") ?? shipment.paid_at ?? now;
  }
  if (target === "posted") {
    patch.posted_at = str("posted_at") ?? shipment.posted_at ?? now;
  }
  if (target === "delivered") {
    patch.delivered_at = str("delivered_at") ?? shipment.delivered_at ?? now;
  }
  if (target === "cancelled") {
    patch.cancelled_at = str("canceled_at") ?? shipment.cancelled_at ?? now;
  }

  // Mesmo status (ou regressão): grava histórico/rastreio sem tocar em status.
  if (target === shipment.status) {
    const admin = createAdminClient();
    const { error } = await admin
      .from("shipments")
      .update(patch)
      .eq("id", shipment.id);
    if (error) throw new Error(`Falha ao atualizar envio: ${error.message}`);
    return { ok: true, reason: "same_status" };
  }

  return applyStatusChange(shipment, target, patch);
}
