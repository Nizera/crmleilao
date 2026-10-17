"use server";

import { revalidatePath } from "next/cache";

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
import { requireAdmin, requireCustomer, searchCustomers, type Customer } from "@/lib/dal";
import { rethrowIfRedirect, type ActionResult } from "@/lib/result";

const failure = (error: string): ActionResult<never> => ({ ok: false, error });

function revalidateChargePaths() {
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

/** Contexto da tela "Nova cobrança": cobrança aberta e lotes elegíveis. */
export async function loadChargeContext(customerId: string): Promise<
  ActionResult<{
    active: { id: string; code: string; amount: number; expires_at: string | null } | null;
    lots: ChargeLotRef[];
  }>
> {
  try {
    await requireAdmin();
    const { activeCharge, eligibleLots } = await getChargeContext(customerId);
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

    const charge = await createCharge({
      customerId: parsed.data.customer_id,
      lotIds: parsed.data.lot_ids,
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
 * Auto-atendimento no painel: o cliente gera o Pix dos lotes que marcou.
 */
export async function createSelfChargeAction(
  lotIds: string[],
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

    const { activeCharge } = await getChargeContext(customer.id);
    if (activeCharge) {
      return failure("Você já tem uma cobrança aguardando pagamento.");
    }

    const charge = await createCharge({
      customerId: customer.id,
      lotIds: parsed.data.lot_ids,
      createdBy: null,
    });

    revalidateChargePaths();
    return { ok: true, data: { charge } };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(error instanceof Error ? error.message : "Erro inesperado.");
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
    return failure(error instanceof Error ? error.message : "Erro inesperado.");
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
    return failure(error instanceof Error ? error.message : "Erro inesperado.");
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
