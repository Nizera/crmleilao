"use server";

import { revalidatePath, updateTag } from "next/cache";

import {
  cancelCharge,
  createCharge,
  getChargeById,
  getChargeContext,
  markChargePaid,
  syncChargeWithMp,
  syncOpenChargesWithMp,
  type MpSyncSummary,
} from "@/lib/charges-server";
import {
  chargeCreateSchema,
  parseChargeLotIds,
  CHARGE_STATUS_LABELS,
  type Charge,
  type ChargeLotRef,
  type ChargeStatus,
} from "@/lib/charges";
import { requireAdmin, requireCustomer, getCustomerFreightState, searchCustomers, type Customer } from "@/lib/dal";
import { rethrowIfRedirect, type ActionResult } from "@/lib/result";

const failure = (error: string): ActionResult<never> => ({ ok: false, error });

/**
 * Erro inesperado numa ação do cliente: o detalhe vai para o log do servidor
 * e o cliente recebe uma frase genérica (nunca `error.message` cru).
 */
function selfError(scope: string, error: unknown): string {
  console.error(
    `[charges] ${scope}:`,
    error instanceof Error ? error.message : error,
  );
  return "Não foi possível concluir agora. Tente novamente em instantes.";
}

function revalidateChargePaths() {
  updateTag("dashboard");
  revalidatePath("/admin/cobrancas");
  revalidatePath("/admin/dashboard");
  revalidatePath("/admin/lotes");
  revalidatePath("/painel");
}

function transitionMessage(reason: string | undefined): string {
  if (reason?.startsWith("already_")) {
    const status = reason.slice("already_".length);
    const label =
      CHARGE_STATUS_LABELS[status as ChargeStatus] ?? status.toLowerCase();
    return `Esta cobrança já está com status “${label}”.`;
  }
  if (reason === "not_found") return "Cobrança não encontrada.";
  if (reason === "no_order") {
    return "Esta cobrança não tem ordem registrada no Mercado Pago. Gere o Pix de novo.";
  }
  if (reason === "order_not_found") {
    return "O Mercado Pago não conhece esta ordem — ela pode ter sido cancelada no painel de lá.";
  }
  if (reason === "reference_mismatch") {
    return "A ordem consultada não é a desta cobrança. Não confirme nada manualmente; confira no painel do Mercado Pago.";
  }
  if (reason?.startsWith("mp_")) {
    return (
      `Ainda não recebemos a confirmação do pagamento no Mercado Pago ` +
      `(status “${reason.slice(3)}”). Pode levar alguns minutos — tente verificar de novo.`
    );
  }
  if (reason === "amount_mismatch") {
    return "O valor pago não confere com o valor da cobrança — confira o extrato do Mercado Pago antes de confirmar.";
  }
  return "Não foi possível concluir a operação.";
}

/** Busca de clientes para o formulário de cobrança (telefone ou nome). */
export async function searchChargeCustomers(
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

/** Contexto da tela "Nova cobrança": cobrança aberta, lotes e frete. */
export async function loadChargeContext(customerId: string): Promise<
  ActionResult<{
    active: { id: string; code: string; amount: number; expires_at: string | null } | null;
    lots: ChargeLotRef[];
    freightDue: boolean;
  }>
> {
  try {
    await requireAdmin();
    const { activeCharge, eligibleLots, freightDue } = await getChargeContext(customerId);
    return {
      ok: true,
      data: {
        active: activeCharge
          ? {
              id: activeCharge.id,
              code: activeCharge.code,
              amount: activeCharge.amount,
              expires_at: activeCharge.expires_at,
            }
          : null,
        lots: eligibleLots,
        freightDue,
      },
    };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(error instanceof Error ? error.message : "Erro inesperado.");
  }
}

/** Cria a cobrança Pix (admin). Devolve os dados para abrir o QR na hora. */
export async function createChargeAction(
  formData: FormData,
): Promise<ActionResult<{ charge: Charge }>> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role === "viewer") {
      return failure("Seu perfil é somente leitura.");
    }

    const parsed = chargeCreateSchema.safeParse({
      customer_id: String(formData.get("customer_id") ?? ""),
      lot_ids: parseChargeLotIds(formData.get("lot_ids")),
    });
    if (!parsed.success) {
      return failure(parsed.error.issues[0]?.message ?? "Dados inválidos.");
    }

    const rawFreight = formData.get("freight");
    const includeFreight =
      rawFreight === "true" || rawFreight === "on" || rawFreight === "1";
    if (parsed.data.lot_ids.length === 0 && !includeFreight) {
      return failure("Selecione ao menos um lote ou marque o frete da semana.");
    }

    const charge = await createCharge({
      customerId: parsed.data.customer_id,
      lotIds: parsed.data.lot_ids,
      includeFreight,
      createdBy: profile.id,
    });

    revalidateChargePaths();
    return { ok: true, data: { charge } };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(error instanceof Error ? error.message : "Erro inesperado.");
  }
}

/**
 * Auto-atendimento no painel: o cliente gera o Pix dos lotes que marcou,
 * opcionalmente incluindo o frete fixo da semana (sozinho ou com os lotes).
 */
export async function createSelfChargeAction(
  lotIds: string[],
  includeFreight = false,
): Promise<ActionResult<{ charge: Charge }>> {
  try {
    const { customer } = await requireCustomer();
    const parsed = chargeCreateSchema.safeParse({
      customer_id: customer.id,
      lot_ids: lotIds,
    });
    if (!parsed.success) {
      return failure(parsed.error.issues[0]?.message ?? "Dados inválidos.");
    }
    if (parsed.data.lot_ids.length === 0 && !includeFreight) {
      return failure("Selecione ao menos um lote ou o frete da semana.");
    }

    if (includeFreight) {
      // Validação amigável antes do createCharge (que também revalida).
      const freight = await getCustomerFreightState(customer.id);
      if (freight.status === "paid") {
        return failure("O frete da semana já foi pago.");
      }
      if (freight.status === "awaiting") {
        return failure(
          "O frete da semana já está em um Pix aguardando pagamento.",
        );
      }
      if (freight.status !== "due") {
        return failure(
          "O frete da semana só aparece depois que um lote seu for cadastrado no período.",
        );
      }
    }

    const { activeCharge } = await getChargeContext(customer.id);
    if (activeCharge) {
      return failure("Você já tem uma cobrança aguardando pagamento.");
    }

    const charge = await createCharge({
      customerId: customer.id,
      lotIds: parsed.data.lot_ids,
      includeFreight,
      createdBy: null,
    });

    revalidateChargePaths();
    return { ok: true, data: { charge } };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(selfError("criar Pix do cliente", error));
  }
}

/** Garante que a cobrança consultada pertence ao cliente logado. */
async function requireOwnCharge(
  id: string,
  customerId: string,
): Promise<ActionResult<Charge>> {
  const charge = await getChargeById(id);
  if (!charge || charge.customer_id !== customerId) {
    return failure("Cobrança não encontrada.");
  }
  return { ok: true, data: charge };
}

/**
 * O cliente cancela o próprio Pix aberto, liberando os lotes para nova
 * cobrança. Sem isso, quem não conseguiu pagar ficaria travado até o
 * Mercado Pago expirar a order (3 dias).
 */
export async function cancelSelfChargeAction(id: string): Promise<ActionResult> {
  try {
    const { customer } = await requireCustomer();
    const own = await requireOwnCharge(id, customer.id);
    if (!own.ok) return own;

    const result = await cancelCharge(own.data.id);
    if (!result.ok) return failure(transitionMessage(result.reason));

    revalidateChargePaths();
    return { ok: true, data: null };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(selfError("cancelar Pix do cliente", error));
  }
}

/** "Já paguei": consulta o Mercado Pago na hora, sem esperar o webhook. */
export async function syncSelfChargeAction(id: string): Promise<ActionResult> {
  try {
    const { customer } = await requireCustomer();
    const own = await requireOwnCharge(id, customer.id);
    if (!own.ok) return own;

    const result = await syncChargeWithMp(own.data.id);
    if (!result.ok) return failure(transitionMessage(result.reason));

    revalidateChargePaths();
    return { ok: true, data: null };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(selfError("sincronizar Pix do cliente", error));
  }
}

/**
 * QR do Pix carregado sob demanda: a listagem não precisa trazer o
 * `qr_code_base64` (pesado) para todo histórico, só quando o cliente abre
 * o QR de uma cobrança própria.
 */
export async function getSelfChargeQrAction(id: string): Promise<
  ActionResult<{
    code: string;
    amount: number;
    expires_at: string | null;
    ticket_url: string | null;
    qr_code: string | null;
    qr_code_base64: string | null;
    freight_amount: number;
    lots: { code: string; title: string }[];
  }>
> {
  try {
    const { customer } = await requireCustomer();
    const own = await requireOwnCharge(id, customer.id);
    if (!own.ok) return own;

    const charge = own.data;
    return {
      ok: true,
      data: {
        code: charge.code,
        amount: Number(charge.amount),
        expires_at: charge.expires_at,
        ticket_url: charge.ticket_url,
        qr_code: charge.qr_code,
        qr_code_base64: charge.qr_code_base64,
        freight_amount: Number(charge.freight_amount ?? 0),
        lots: (charge.lots ?? []).map((lot) => ({ code: lot.code, title: lot.title })),
      },
    };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(selfError("buscar QR do cliente", error));
  }
}

/**
 * Registro completo de uma cobrança para o admin abrir o QR/detalhes: a
 * listagem traz colunas magras (sem `qr_code_base64`), então o painel busca
 * o registro na hora — igual ao fluxo do cliente.
 */
export async function getChargeQrAction(
  id: string,
): Promise<ActionResult<Charge>> {
  try {
    await requireAdmin();
    const charge = await getChargeById(id);
    if (!charge) return failure("Cobrança não encontrada.");
    return { ok: true, data: charge };
  } catch (error) {
    rethrowIfRedirect(error);
    console.error(
      "[charges] buscar QR do admin:",
      error instanceof Error ? error.message : error,
    );
    return failure("Não foi possível carregar o QR agora. Tente novamente.");
  }
}

/** Cancela uma cobrança aberta (os lotes voltam a ficar elegíveis). */
export async function cancelChargeAction(id: string): Promise<ActionResult> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role === "viewer") {
      return failure("Seu perfil é somente leitura.");
    }

    const result = await cancelCharge(id);
    if (!result.ok) return failure(transitionMessage(result.reason));

    revalidateChargePaths();
    return { ok: true, data: null };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(error instanceof Error ? error.message : "Erro inesperado.");
  }
}

/** Marcação manual de pago (sem webhook configurado). */
export async function markChargePaidAction(id: string): Promise<ActionResult> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role === "viewer") {
      return failure("Seu perfil é somente leitura.");
    }

    const result = await markChargePaid(id);
    if (!result.ok) return failure(transitionMessage(result.reason));

    revalidateChargePaths();
    return { ok: true, data: null };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(error instanceof Error ? error.message : "Erro inesperado.");
  }
}

/** Reconsulta a ordem no Mercado Pago e aplica o status — sem esperar o webhook. */
export async function syncChargeAction(id: string): Promise<ActionResult> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role === "viewer") {
      return failure("Seu perfil é somente leitura.");
    }

    const result = await syncChargeWithMp(id);
    if (!result.ok) return failure(transitionMessage(result.reason));

    revalidateChargePaths();
    return { ok: true, data: null };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(error instanceof Error ? error.message : "Erro inesperado.");
  }
}

/** Sincroniza em lote as cobranças abertas que já têm ordem no MP. */
export async function syncPendingChargesAction(
  limit = 25,
): Promise<ActionResult<MpSyncSummary>> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role === "viewer") {
      return failure("Seu perfil é somente leitura.");
    }

    const safeLimit = Math.min(Math.max(Math.trunc(Number(limit) || 25), 1), 50);
    const summary = await syncOpenChargesWithMp(safeLimit);

    revalidateChargePaths();
    return { ok: true, data: summary };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(error instanceof Error ? error.message : "Erro inesperado.");
  }
}
