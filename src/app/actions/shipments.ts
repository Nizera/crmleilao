"use server";

import { revalidatePath, updateTag } from "next/cache";

import { logWaMessage } from "@/app/actions/lots";
import { requireAdmin, searchCustomers, type Customer } from "@/lib/dal";
import { rethrowIfRedirect, type ActionResult } from "@/lib/result";
import {
  quoteFrete,
  sfConfigured,
  sfSandbox,
  SUPERFRETE_SERVICES,
  type SfQuoteOption,
} from "@/lib/superfrete";
import {
  canPayShipment,
  defaultShipmentVolume,
  type Shipment,
} from "@/lib/shipments";
import {
  cancelShipment,
  emitShipment,
  ensureSuperfreteWebhook,
  getOrigin,
  getShipmentById,
  getWebhookSecret,
  listEligibleShipmentLots,
  missingRecipientFields,
  payShipment,
  refreshPrintUrl,
  syncShipment,
  type EligibleShipmentLot,
} from "@/lib/shipments-server";
import { renderTemplate } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import { formatBRL, waMessageLink } from "@/lib/lots";

const failure = (error: string): ActionResult<never> => ({ ok: false, error });

function revalidateShipmentPaths() {
  updateTag("dashboard");
  revalidatePath("/admin/envios");
  revalidatePath("/painel");
  revalidatePath("/admin/lotes");
  revalidatePath("/admin/dashboard");
}

/** Busca de clientes para o formulário de envio. */
export async function searchShipmentCustomers(
  query: string,
): Promise<ActionResult<Customer[]>> {
  try {
    await requireAdmin();
    return { ok: true, data: await searchCustomers(query) };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(error instanceof Error ? error.message : "Erro inesperado.");
  }
}

export type ShipmentContext = {
  lots: EligibleShipmentLot[];
  /** Campos da ficha que faltam para emitir a etiqueta. */
  missing: string[];
  /** Resumo do endereço para exibição. */
  addressLine: string | null;
  defaultBatchDate: string | null;
  defaultVolume: ReturnType<typeof defaultShipmentVolume>;
  originReady: boolean;
  superfreteReady: boolean;
  sandbox: boolean;
  webhookActive: boolean;
};

/** Contexto da tela "Novo envio" (lotes elegíveis + pendências + ambiente). */
export async function loadShipmentContext(
  customerId: string,
): Promise<ActionResult<ShipmentContext>> {
  try {
    await requireAdmin();

    const supabase = await createClient();
    const { data: customer, error } = await supabase
      .from("customers")
      .select(
        "name, email, cpf_cnpj, phone_e164, address_cep, address_street, address_number, address_complement, address_district, address_city, address_state",
      )
      .eq("id", customerId)
      .maybeSingle();

    if (error) return failure(`Falha ao carregar cliente: ${error.message}`);
    if (!customer) return failure("Cliente não encontrado.");

    const lots = await listEligibleShipmentLots(customerId);
    const missing = missingRecipientFields(
      customer as Parameters<typeof missingRecipientFields>[0],
    );

    const addressParts = [
      customer.address_street,
      customer.address_number,
      customer.address_district,
      customer.address_city,
      customer.address_state,
      customer.address_cep,
    ].filter(Boolean) as string[];

    const shippingDates = lots
      .map((lot) => lot.shipping_date)
      .filter((date): date is string => Boolean(date))
      .sort();
    const defaultBatchDate = shippingDates[0] ?? null;

    return {
      ok: true,
      data: {
        lots,
        missing,
        addressLine: addressParts.length > 0 ? addressParts.join(", ") : null,
        defaultBatchDate,
        defaultVolume: defaultShipmentVolume(Math.max(1, lots.length)),
        originReady: (await getOrigin()) !== null,
        superfreteReady: sfConfigured(),
        sandbox: sfSandbox(),
        webhookActive: (await getWebhookSecret()) !== null,
      },
    };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(error instanceof Error ? error.message : "Erro inesperado.");
  }
}

type VolumeInput = {
  height: number;
  width: number;
  length: number;
  weight: number;
};

function parseVolume(raw: unknown): VolumeInput {
  const volume = (raw ?? {}) as Record<string, unknown>;
  const parsed = {
    height: Number(volume.height),
    width: Number(volume.width),
    length: Number(volume.length),
    weight: Number(volume.weight),
  };
  const valid = Object.values(parsed).every(
    (value) => Number.isFinite(value) && value > 0,
  );
  if (!valid) throw new Error("Dimensões da caixa inválidas.");
  return parsed;
}

/** Um envio de leilão nunca junta mais que isso de lote; teto contra payload gigante. */
const MAX_SHIPMENT_LOT_IDS = 500;

function parseLotIds(raw: unknown): string[] {
  let ids: string[] | null = null;
  if (Array.isArray(raw)) ids = raw.map(String);
  else if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) ids = parsed.map(String);
    } catch {
      /* cai no erro abaixo */
    }
  }
  if (!ids) throw new Error("Lista de lotes inválida.");
  if (ids.length > MAX_SHIPMENT_LOT_IDS) {
    throw new Error(`Lista de lotes grande demais (máximo ${MAX_SHIPMENT_LOT_IDS}).`);
  }
  return ids;
}

/** Seguro vindo do form: vazio/nulo = usar a soma dos lotes. Aceita "25,63". */
function parseInsurance(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const value =
    typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Seguro declarado inválido (use números, ex.: 25,63).");
  }
  return Math.round(value * 100) / 100;
}

async function insuranceFor(
  customerId: string,
  lotIds: string[],
): Promise<number> {
  const eligible = await listEligibleShipmentLots(customerId);
  const picked = eligible.filter((lot) => lotIds.includes(lot.id));
  if (picked.length === 0) {
    throw new Error("Nenhum lote elegível selecionado.");
  }
  return (
    Math.round(
      picked.reduce((sum, lot) => sum + Number(lot.arremate_value), 0) * 100,
    ) / 100
  );
}

/** Cotação multi-transportadora para os lotes escolhidos. */
export async function quoteShipmentAction(input: {
  customerId: string;
  lotIds: unknown;
  volume: unknown;
  insuranceValue?: unknown;
}): Promise<ActionResult<{ options: SfQuoteOption[]; errors: string[] }>> {
  try {
    await requireAdmin();

    const lotIds = parseLotIds(input.lotIds);
    const volume = parseVolume(input.volume);
    const lotsInsurance = await insuranceFor(input.customerId, lotIds);
    const insuranceValue = parseInsurance(input.insuranceValue) ?? lotsInsurance;
    if (
      insuranceValue > 0 &&
      Math.round(insuranceValue * 100) !== Math.round(lotsInsurance * 100)
    ) {
      return failure(
        `Com seguro, o valor precisa ser igual ao subtotal dos lotes (${formatBRL(lotsInsurance)}).`,
      );
    }

    const origin = await getOrigin();
    if (!origin) {
      return failure(
        "Endereço de origem incompleto. Preencha em Configuração → Endereço de origem (envios).",
      );
    }

    const supabase = await createClient();
    const { data: customer } = await supabase
      .from("customers")
      .select("address_cep")
      .eq("id", input.customerId)
      .maybeSingle();

    const destinationCep = customer?.address_cep;
    if (!destinationCep) {
      return failure("O cliente ainda não tem CEP preenchido.");
    }

    const { options, errors } = await quoteFrete({
      fromCep: origin.postal_code,
      toCep: destinationCep,
      volume,
      insuranceValue,
    });

    if (options.length === 0) {
      return failure(
        errors.length > 0
          ? `Nenhuma transportadora aceitou a cotação: ${errors.join(" · ")}`
          : "Nenhuma transportadora retornou opção para este CEP (confira a caixa, o peso e se há ponto de postagem próximo).",
      );
    }

    return { ok: true, data: { options, errors } };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(error instanceof Error ? error.message : "Erro inesperado.");
  }
}

/** Emite a etiqueta (cart → insert → checkout) e devolve o envio. */
export async function emitShipmentAction(input: {
  customerId: string;
  lotIds: unknown;
  serviceId: number;
  volume: unknown;
  batchDate?: string | null;
  insuranceValue?: unknown;
}): Promise<ActionResult<{ shipment: Shipment; warning?: string }>> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role === "viewer") {
      return failure("Seu perfil é somente leitura.");
    }

    const service = SUPERFRETE_SERVICES.find((item) => item.id === input.serviceId);
    if (!service) return failure("Transportadora inválida.");

    const lotIds = parseLotIds(input.lotIds);
    const volume = parseVolume(input.volume);
    const insuranceOverride = parseInsurance(input.insuranceValue);
    const batchDate =
      typeof input.batchDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(input.batchDate)
        ? input.batchDate
        : null;

    const result = await emitShipment({
      customerId: input.customerId,
      lotIds,
      serviceId: service.id,
      volume,
      batchDate,
      insuranceValue: insuranceOverride,
      createdBy: profile.id,
    });

    revalidateShipmentPaths();
    return { ok: true, data: result };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(error instanceof Error ? error.message : "Erro inesperado.");
  }
}

/** Paga a etiqueta pendente com o saldo da carteira. */
export async function payShipmentAction(id: string): Promise<ActionResult<Shipment>> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role === "viewer") {
      return failure("Seu perfil é somente leitura.");
    }

    const shipment = await payShipment(id);
    revalidateShipmentPaths();
    return { ok: true, data: shipment };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(error instanceof Error ? error.message : "Erro inesperado.");
  }
}

/** Ressincroniza status/rastreio direto da API (sem esperar o webhook). */
export async function syncShipmentAction(
  id: string,
): Promise<ActionResult<Shipment>> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role === "viewer") {
      return failure("Seu perfil é somente leitura.");
    }

    const shipment = await syncShipment(id);
    revalidateShipmentPaths();
    return { ok: true, data: shipment };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(error instanceof Error ? error.message : "Erro inesperado.");
  }
}

/** Cancela a etiqueta na SuperFrete (estorno para a carteira). */
export async function cancelShipmentAction(id: string): Promise<ActionResult<Shipment>> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role === "viewer") {
      return failure("Seu perfil é somente leitura.");
    }

    const shipment = await cancelShipment(id);
    revalidateShipmentPaths();
    return { ok: true, data: shipment };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(error instanceof Error ? error.message : "Erro inesperado.");
  }
}

/** Link do PDF da etiqueta (gera de novo se preciso). */
export async function printShipmentAction(
  id: string,
): Promise<ActionResult<{ url: string }>> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role === "viewer") {
      return failure("Seu perfil é somente leitura.");
    }

    const shipment = await getShipmentById(id);
    if (!shipment) return failure("Envio não encontrado.");

    if (shipment.label_print_url && !canPayShipment(shipment.status)) {
      return { ok: true, data: { url: shipment.label_print_url } };
    }

    const result = await refreshPrintUrl(id);
    revalidateShipmentPaths();
    return { ok: true, data: result };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(error instanceof Error ? error.message : "Erro inesperado.");
  }
}

/** Cadastra o webhook SuperFrete (dono) e grava o secret. */
export async function ensureWebhookAction(): Promise<ActionResult<{ created: boolean }>> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role !== "owner") {
      return failure("Apenas o dono ativa o webhook.");
    }

    const result = await ensureSuperfreteWebhook();
    revalidateShipmentPaths();
    return { ok: true, data: result };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(error instanceof Error ? error.message : "Erro inesperado.");
  }
}

/**
 * Mensagem de aviso de envio (modelo de Configuração com rastreio).
 * O cliente abre o link e registra via logWaMessage.
 */
export async function getShippingNoticeAction(id: string): Promise<
  ActionResult<{ text: string; link: string }>
> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role === "viewer") {
      return failure("Seu perfil é somente leitura.");
    }

    const shipment = await getShipmentById(id);
    if (!shipment) return failure("Envio não encontrado.");
    if (!shipment.tracking_code) {
      return failure("Este envio ainda não tem código de rastreio.");
    }

    const supabase = await createClient();
    const { data: settings } = await supabase
      .from("app_settings")
      .select("wa_shipping_template")
      .eq("id", true)
      .maybeSingle();

    const text = renderTemplate(
      settings?.wa_shipping_template ??
        "Olá {name}! O lote {code} foi enviado.\nRastreio: {tracking}",
      {
        name: shipment.customer?.name?.split(" ")[0] ?? "",
        code: shipment.code,
        tracking: shipment.tracking_code,
      },
    );

    const phone = shipment.customer?.phone_e164 ?? "";
    return {
      ok: true,
      data: { text, link: waMessageLink(phone, text) },
    };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(error instanceof Error ? error.message : "Erro inesperado.");
  }
}

/** Registra no message_log que o aviso foi levado ao WhatsApp. */
export async function logShippingNotice(
  shipmentId: string,
  text: string,
  link: string,
): Promise<ActionResult> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role === "viewer") {
      return failure("Seu perfil é somente leitura.");
    }

    const shipment = await getShipmentById(shipmentId);
    if (!shipment) return failure("Envio não encontrado.");
    return logWaMessage({
      customer_id: shipment.customer_id,
      kind: "shipping_notice",
      text_body: text,
      link,
    });
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(error instanceof Error ? error.message : "Erro inesperado.");
  }
}
