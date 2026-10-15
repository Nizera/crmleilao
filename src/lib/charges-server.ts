import "server-only";

import {
  isChargeActive,
  isChargeOpen,
  type Charge,
  type ChargeLotRef,
  type ChargeStatus,
} from "@/lib/charges";
import { cancelPixOrder, createPixOrder } from "@/lib/mercadopago";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Núcleo das cobranças Pix (F3) — server-only.
 * Tudo aqui usa service role: o webhook não tem sessão e as actions validam
 * os guards (admin/customer) antes de chamar.
 */

export const CHARGE_COLUMNS = [
  "id, code, customer_id, amount, status, mp_payment_id, external_reference,",
  "description, qr_code, qr_code_base64, ticket_url, expires_at, paid_at,",
  "created_by, created_at, updated_at,",
  "customer:customers(id, name, phone_e164),",
  "lots:lots(id, code, title, arremate_value, status)",
].join(" ");

export type TransitionResult = { ok: boolean; reason?: string };

/** Lotes `pending_payment` do cliente que ainda não estão numa cobrança aberta. */
export async function listEligibleLots(customerId: string): Promise<ChargeLotRef[]> {
  const refs = await listEligibleLotRefs(customerId);
  return refs.map(({ id, code, title, arremate_value, status }) => ({
    id,
    code,
    title,
    arremate_value,
    status,
  }));
}

/**
 * Idem, mantendo o `charge_id` atual — o claim atômico da criação de cobrança
 * precisa saber para qual cobrança obsoleta o lote ainda aponta (expirou por
 * tempo, sem webhook) antes de reivindicá-lo.
 */
export async function listEligibleLotRefs(
  customerId: string,
): Promise<(ChargeLotRef & { charge_id: string | null })[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("lots")
    .select(
      "id, code, title, arremate_value, status, charge_id, charge:charges(status, expires_at)",
    )
    .eq("customer_id", customerId)
    .eq("status", "pending_payment")
    .order("auction_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Falha ao listar lotes: ${error.message}`);

  type Row = ChargeLotRef & {
    charge_id: string | null;
    charge: { status: ChargeStatus; expires_at: string | null } | null;
  };

  return ((data ?? []) as unknown as Row[])
    .filter((row) => !row.charge || !isChargeActive(row.charge))
    .map((row) => ({
      id: row.id,
      code: row.code,
      title: row.title,
      arremate_value: row.arremate_value,
      status: row.status,
      charge_id: row.charge_id,
    }));
}

/**
 * Contexto para criar cobrança: cobrança aberta do cliente (se houver) e
 * lotes ainda elegíveis.
 */
export async function getChargeContext(customerId: string): Promise<{
  activeCharge: Charge | null;
  eligibleLots: ChargeLotRef[];
}> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("charges")
    .select(CHARGE_COLUMNS)
    .eq("customer_id", customerId)
    .in("status", ["pending", "in_process"])
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) throw new Error(`Falha ao carregar cobranças: ${error.message}`);

  const rows = (data ?? []) as unknown as Charge[];
  const activeCharge = rows.find((charge) => isChargeActive(charge)) ?? null;
  const eligibleLots = await listEligibleLots(customerId);

  return { activeCharge, eligibleLots };
}

export async function getChargeById(id: string): Promise<Charge | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("charges")
    .select(CHARGE_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Falha ao carregar cobrança: ${error.message}`);
  return (data as unknown as Charge) ?? null;
}

export async function getChargeByExternalReference(
  reference: string,
): Promise<Charge | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("charges")
    .select(CHARGE_COLUMNS)
    .eq("external_reference", reference)
    .maybeSingle();

  if (error) throw new Error(`Falha ao carregar cobrança: ${error.message}`);
  return (data as unknown as Charge) ?? null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Cria a cobrança Pix no Mercado Pago, grava em `charges` e vincula os lotes.
 * Ordem: MP primeiro (se falhar, nada fica no banco); depois insert; depois
 * vínculo. Um PIX órfão no MP expira sozinho em 3 dias.
 */
export async function createCharge(input: {
  customerId: string;
  lotIds: string[];
  createdBy: string | null;
}): Promise<Charge> {
  const admin = createAdminClient();

  const { data: customer, error: customerError } = await admin
    .from("customers")
    .select("id, name, phone_e164, email, cpf_cnpj")
    .eq("id", input.customerId)
    .maybeSingle();

  if (customerError) {
    throw new Error(`Falha ao carregar cliente: ${customerError.message}`);
  }
  if (!customer) throw new Error("Cliente não encontrado.");

  const eligible = await listEligibleLotRefs(input.customerId);
  const picked = eligible.filter((lot) => input.lotIds.includes(lot.id));
  if (picked.length === 0) {
    throw new Error("Nenhum dos lotes selecionados está aguardando pagamento.");
  }

  const amount = round2(
    picked.reduce((sum, lot) => sum + Number(lot.arremate_value), 0),
  );
  if (amount <= 0) {
    throw new Error("O valor total da cobrança precisa ser maior que zero.");
  }

  const email = customer.email?.trim() || null;
  if (!email) {
    throw new Error(
      "Este cliente ainda não tem e-mail. Preencha o e-mail na ficha do cliente (ou em Meus dados do painel) e gere o Pix de novo.",
    );
  }

  const externalReference = `chg_${crypto.randomUUID()}`;
  const description = `Leilão Legends — ${
    picked.length === 1 ? "lote" : "lotes"
  } ${picked.map((lot) => lot.code).join(", ")}`;

  const [firstName, ...rest] = (customer.name?.trim() || "Cliente").split(/\s+/);
  const digits = (customer.cpf_cnpj ?? "").replace(/\D/g, "");

  // 1) Registro local ANTES do Pix. Assim dá para reclamar os lotes de forma
  //    atômica e só emitir a ordem de pagamento se o reclame for nosso — sem
  //    isso, duas requisições simultâneas geravam DOIS Pix para os mesmos lotes.
  const { data: inserted, error: insertError } = await admin
    .from("charges")
    .insert({
      customer_id: input.customerId,
      amount,
      status: "pending",
      external_reference: externalReference,
      description,
      created_by: input.createdBy,
    })
    .select("id")
    .single();

  if (insertError) {
    throw new Error(`Falha ao registrar cobrança: ${insertError.message}`);
  }

  const chargeId = inserted.id as string;
  const pickedIds = picked.map((lot) => lot.id);

  /** Desfaz o reclame e apaga a cobrança órfã (usado quando algo falha). */
  const rollback = async () => {
    const unlink = await admin
      .from("lots")
      .update({ charge_id: null })
      .eq("charge_id", chargeId);
    if (unlink.error) console.error("[charges] rollback de vínculo:", unlink.error);

    const remove = await admin.from("charges").delete().eq("id", chargeId);
    if (remove.error) console.error("[charges] rollback da cobrança:", remove.error);
  };

  // 2) Lotes elegíveis podem apontar para uma cobrança que expirou por tempo
  //    (sem webhook). Libera esses vínculos obsoletos antes de reclamar.
  const staleIds = picked
    .filter((lot) => lot.charge_id)
    .map((lot) => lot.id);
  if (staleIds.length > 0) {
    await admin
      .from("lots")
      .update({ charge_id: null })
      .in("id", staleIds)
      .eq("status", "pending_payment");
  }

  // 3) Reclame atômico: só vence quem conseguir todas as linhas.
  const { data: claimed, error: claimError } = await admin
    .from("lots")
    .update({ charge_id: chargeId })
    .in("id", pickedIds)
    .eq("status", "pending_payment")
    .is("charge_id", null)
    .select("id");

  if (claimError) {
    await rollback();
    throw new Error(`Falha ao vincular os lotes à cobrança: ${claimError.message}`);
  }
  if ((claimed?.length ?? 0) !== pickedIds.length) {
    await rollback();
    throw new Error(
      "Outra cobrança para estes lotes foi criada agora. Recarregue a tela e confira as cobranças em aberto.",
    );
  }

  // 4) Só agora emite o Pix — o lote já está reservado para esta cobrança.
  let order;
  try {
    order = await createPixOrder({
      amount,
      description,
      externalReference,
      payerEmail: email,
      payerFirstName: firstName,
      payerLastName: rest.join(" ") || undefined,
      identification:
        digits.length === 11
          ? { type: "CPF", number: digits }
          : digits.length === 14
            ? { type: "CNPJ", number: digits }
            : undefined,
    });
  } catch (error) {
    // A order pode ter chegado a existir no MP antes da rede falhar. Desfaz o
    // reclame mesmo assim (o caso comum é não ter sido criada) e deixa o
    // external_reference no log para conferir no painel do Mercado Pago.
    console.error(
      `[charges] falha ao criar Pix (${externalReference}):`,
      error instanceof Error ? error.message : error,
    );
    await rollback();
    throw error;
  }

  const { error: saveError } = await admin
    .from("charges")
    .update({
      mp_payment_id: order.orderId || null,
      qr_code: order.qrCode,
      qr_code_base64: order.qrCodeBase64,
      ticket_url: order.ticketUrl,
      expires_at: order.dateOfExpiration,
    })
    .eq("id", chargeId);

  if (saveError) {
    console.error(
      `[charges] não foi possível salvar o Pix da cobrança ${chargeId} ` +
        `(order ${order.orderId}): ${saveError.message}`,
    );

    // Apagar a cobrança aqui deixaria a order viva no Mercado Pago sem
    // correspondência local: um pagamento nela não teria onde cair. Só
    // desfazemos se o cancelamento no MP for confirmado.
    if (order.orderId && (await cancelPixOrder(order.orderId))) {
      await rollback();
      throw new Error(
        `Falha ao salvar o Pix da cobrança: ${saveError.message}. ` +
          "A ordem foi cancelada no Mercado Pago — tente gerar de novo.",
      );
    }

    throw new Error(
      "A cobrança foi criada no Mercado Pago, mas não foi possível salvar o QR aqui. " +
        "Recarregue a tela: ela deve aparecer em Cobranças. Se não aparecer, " +
        "cancele a cobrança aberta no painel do Mercado Pago e gere outra.",
    );
  }

  const charge = await getChargeById(chargeId);
  if (!charge) throw new Error("Cobrança criada, mas não foi possível recarregá-la.");

  // Caso raro: a order já saiu processada na criação (não acontece no Pix).
  if (order.status === "processed") {
    await applyTransition(charge, "approved", { paidAt: new Date().toISOString() });
    return (await getChargeById(charge.id)) ?? charge;
  }

  return charge;
}

/**
 * Transição de status idempotente:
 *  - só sai de pending/in_process (webhook repetido não reprocessa);
 *  - `approved` confere o valor quando o webhook informa (proteção extra
 *    contra referência trocada).
 */
async function applyTransition(
  charge: Charge,
  target: ChargeStatus,
  opts: {
    mpPaymentId?: string | null;
    amount?: number | null;
    paidAt?: string | null;
  } = {},
): Promise<TransitionResult> {
  const admin = createAdminClient();

  if (!isChargeOpen(charge.status)) {
    return { ok: false, reason: `already_${charge.status}` };
  }

  if (
    target === "approved" &&
    opts.amount != null &&
    Math.abs(Number(charge.amount) - opts.amount) > 0.01
  ) {
    console.warn(
      `[charges] valor divergente em ${charge.code}: local=${charge.amount} mp=${opts.amount}`,
    );
    return { ok: false, reason: "amount_mismatch" };
  }

  const paidAt = opts.paidAt ?? (target === "approved" ? new Date().toISOString() : null);
  const patch: Record<string, unknown> = { status: target };
  if (target === "approved") {
    patch.paid_at = paidAt;
    if (opts.mpPaymentId) patch.mp_payment_id = opts.mpPaymentId;
  }

  const { data: updated, error } = await admin
    .from("charges")
    .update(patch)
    .eq("id", charge.id)
    .in("status", ["pending", "in_process"])
    .select("id, paid_at");

  if (error) throw new Error(`Falha ao atualizar cobrança: ${error.message}`);
  if (!updated || updated.length === 0) {
    return { ok: false, reason: `already_${target}` };
  }

  if (target === "approved") {
    const { error: lotsError } = await admin
      .from("lots")
      .update({ status: "paid", paid_at: paidAt })
      .eq("charge_id", charge.id)
      .eq("status", "pending_payment");

    if (lotsError) {
      // Desfaz a transição para que um reenvio do webhook possa concluir.
      // Sem isso, toda nova tentativa cairia em `already_approved` e os
      // lotes ficariam eternamente como "aguardando pagamento".
      await admin
        .from("charges")
        .update({ status: charge.status, paid_at: null })
        .eq("id", charge.id)
        .eq("status", "approved");
      throw new Error(`Falha ao marcar os lotes como pagos: ${lotsError.message}`);
    }
  } else {
    // Cobrança que não vai ser paga devolve os lotes ao estado elegível.
    const { error: unlinkError } = await admin
      .from("lots")
      .update({ charge_id: null })
      .eq("charge_id", charge.id);

    if (unlinkError) {
      console.error("[charges] falha ao liberar lotes:", unlinkError);
    }
  }

  return { ok: true };
}

/** Webhook: localiza por external_reference e aplica o status vindo do MP. */
export async function settleChargeByReference(input: {
  externalReference: string;
  target: Extract<ChargeStatus, "approved" | "expired" | "cancelled" | "rejected">;
  mpPaymentId?: string | null;
  amount?: number | null;
  paidAt?: string | null;
}): Promise<TransitionResult> {
  const charge = await getChargeByExternalReference(input.externalReference);
  if (!charge) return { ok: false, reason: "not_found" };

  return applyTransition(charge, input.target, {
    mpPaymentId: input.mpPaymentId,
    amount: input.amount,
    paidAt: input.paidAt,
  });
}

/** Marcação manual de pago (sem webhook configurado). */
export async function markChargePaid(chargeId: string): Promise<TransitionResult> {
  const charge = await getChargeById(chargeId);
  if (!charge) return { ok: false, reason: "not_found" };
  return applyTransition(charge, "approved", { paidAt: new Date().toISOString() });
}

/** Cancelamento manual: devolve os lotes para elegíveis (status fica cancelled). */
export async function cancelCharge(chargeId: string): Promise<TransitionResult> {
  const charge = await getChargeById(chargeId);
  if (!charge) return { ok: false, reason: "not_found" };
  return applyTransition(charge, "cancelled");
}
