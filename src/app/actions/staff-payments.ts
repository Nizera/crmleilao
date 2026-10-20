"use server";

import { revalidatePath, updateTag } from "next/cache";

import { isChargeActive, type ChargeStatus } from "@/lib/charges";
import { listTeam, requireAdmin } from "@/lib/dal";
import {
  isoDayAdd,
  isIsoDay,
  spDayEndUtc,
  spDayOf,
  spDayStartUtc,
  spToday,
} from "@/lib/dates";
import { rethrowIfRedirect, type ActionResult } from "@/lib/result";
import {
  parseMoney,
  staffPaymentSchema,
  type ClosingData,
  type ClosingEntry,
  type ClosingHistoryDay,
  type ClosingPendingCharge,
  type ClosingStaffMember,
} from "@/lib/staff-payments";
import { createAdminClient } from "@/lib/supabase/admin";

const failure = (error: string): ActionResult<never> => ({ ok: false, error });

/** Status que contam como recebido — mesma lista do dashboard. */
const REVENUE_CHARGE_LOTS = ["paid", "shipped", "delivered"] as const;

const HISTORY_DAYS = 7;

function revalidateClosing() {
  updateTag("dashboard");
  revalidatePath("/admin/dashboard");
}

/**
 * Contexto do fechamento de um dia: entradas recebidas, cobranças em aberto,
 * equipe com o que foi pago naquela data e histórico recente. Só o dono.
 *
 * `asOf` é a data civil em America/Sao_Paulo (YYYY-MM-DD); sem parâmetro usa
 * hoje. Datas inválidas caem em hoje.
 */
export async function getClosingDataAction(
  asOf?: string,
): Promise<ActionResult<ClosingData>> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role !== "owner") {
      return failure("Apenas o dono faz o fechamento do dia.");
    }

    const supabase = createAdminClient();
    const now = new Date();
    const date = isIsoDay(asOf) ? asOf : spToday();
    const historyFrom = isoDayAdd(date, -(HISTORY_DAYS - 1));
    // Janela exata do dia-alvo em UTC (fim do dia 19 em SP = 03:00Z do dia 20).
    const paidFrom = spDayStartUtc(date);
    const paidTo = spDayEndUtc(date);

    const [lotsRes, chargesRes, paymentsRes, historyRes, team] =
      await Promise.all([
        supabase
          .from("lots")
          .select(
            "code, title, arremate_value, paid_at, customer:customers(name)",
          )
          .in("status", [...REVENUE_CHARGE_LOTS])
          .gte("paid_at", paidFrom)
          .lt("paid_at", paidTo)
          .order("paid_at", { ascending: false })
          .limit(100),
        supabase
          .from("charges")
          .select(
            "id, code, amount, status, expires_at, ticket_url, customer:customers(name, phone_e164)",
          )
          .or("status.in.(pending,in_process)")
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("staff_payments")
          .select("staff_id, amount, notes")
          .eq("payment_date", date),
        supabase
          .from("staff_payments")
          .select("payment_date, amount")
          .gte("payment_date", historyFrom)
          .lte("payment_date", date)
          .order("payment_date", { ascending: false })
          .limit(200),
        listTeam().catch(() => null),
      ]);

    if (lotsRes.error) throw new Error(lotsRes.error.message);
    if (chargesRes.error) throw new Error(chargesRes.error.message);
    if (paymentsRes.error) throw new Error(paymentsRes.error.message);
    if (historyRes.error) throw new Error(historyRes.error.message);

    type LotRow = {
      code: string;
      title: string;
      arremate_value: number | string;
      paid_at: string | null;
      customer: { name: string | null } | null;
    };
    type ChargeRow = {
      id: string;
      code: string;
      amount: number | string;
      status: ChargeStatus;
      expires_at: string | null;
      ticket_url: string | null;
      customer: { name: string | null; phone_e164: string } | null;
    };

    // O banco já corta o dia exato em UTC (paidFrom/paidTo); o filtro por
    // fuso aqui é só defesa extra contra qualquer paid_at fora do padrão.
    const entries: ClosingEntry[] = ((lotsRes.data ?? []) as unknown as LotRow[])
      .filter((lot) => lot.paid_at && spDayOf(lot.paid_at) === date)
      .map((lot) => ({
        code: lot.code,
        title: lot.title,
        customer: lot.customer?.name?.trim() || "Sem nome",
        value: Number(lot.arremate_value),
        paidAt: lot.paid_at ?? "",
      }));

    const pendingCharges: ClosingPendingCharge[] = (
      (chargesRes.data ?? []) as unknown as ChargeRow[]
    )
      .filter((charge) => isChargeActive(charge, now))
      .slice(0, 50)
      .map((charge) => ({
        id: charge.id,
        code: charge.code,
        amount: Number(charge.amount),
        customerName: charge.customer?.name?.trim() || null,
        phone_e164: charge.customer?.phone_e164 ?? "",
        ticketUrl: charge.ticket_url,
        expiresAt: charge.expires_at,
      }));

    const paymentByStaff = new Map<
      string,
      { amount: number; notes: string | null }
    >();
    for (const row of (paymentsRes.data ?? []) as {
      staff_id: string;
      amount: number | string;
      notes: string | null;
    }[]) {
      paymentByStaff.set(row.staff_id, {
        amount: Number(row.amount),
        notes: row.notes,
      });
    }

    const staff: ClosingStaffMember[] = (team ?? []).map((member) => ({
      id: member.id,
      name: member.name,
      role: member.role,
      payment: paymentByStaff.get(member.id) ?? null,
    }));

    const historyMap = new Map<string, ClosingHistoryDay>();
    for (const row of (historyRes.data ?? []) as {
      payment_date: string;
      amount: number | string;
    }[]) {
      const entry = historyMap.get(row.payment_date) ?? {
        date: row.payment_date,
        amount: 0,
        count: 0,
      };
      entry.amount += Number(row.amount);
      entry.count += 1;
      historyMap.set(row.payment_date, entry);
    }
    const history = [...historyMap.values()].sort((a, b) =>
      b.date.localeCompare(a.date),
    );

    return {
      ok: true,
      data: {
        date,
        receivedOn: entries.reduce((sum, entry) => sum + entry.value, 0),
        entries,
        pendingCharges,
        pendingTotal: pendingCharges.reduce(
          (sum, charge) => sum + charge.amount,
          0,
        ),
        staff,
        history,
      },
    };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(
      error instanceof Error
        ? error.message
        : "Não foi possível carregar o fechamento.",
    );
  }
}

/** Registra (ou corrige) o pagamento do dia para um membro da equipe. */
export async function saveStaffPaymentAction(
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role !== "owner") {
      return failure("Apenas o dono registra pagamentos da equipe.");
    }

    const date =
      String(formData.get("payment_date") ?? "").trim() || spToday();
    const parsed = staffPaymentSchema.safeParse({
      staff_id: String(formData.get("staff_id") ?? ""),
      payment_date: date,
      amount: parseMoney(String(formData.get("amount") ?? "")) ?? Number.NaN,
      notes: String(formData.get("notes") ?? "").trim() || undefined,
    });
    if (!parsed.success) {
      return failure(parsed.error.issues[0]?.message ?? "Dados inválidos.");
    }

    const supabase = createAdminClient();
    const { error } = await supabase.from("staff_payments").upsert(
      {
        staff_id: parsed.data.staff_id,
        payment_date: parsed.data.payment_date,
        amount: parsed.data.amount,
        notes: parsed.data.notes ?? null,
        created_by: profile.id,
      },
      { onConflict: "staff_id,payment_date" },
    );
    if (error) throw new Error(error.message);

    revalidateClosing();
    return { ok: true, data: null };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(
      error instanceof Error
        ? error.message
        : "Não foi possível registrar o pagamento.",
    );
  }
}

/** Remove o pagamento registrado para um membro em uma data. */
export async function deleteStaffPaymentAction(
  staffId: string,
  paymentDate: string,
): Promise<ActionResult<null>> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role !== "owner") {
      return failure("Apenas o dono altera pagamentos da equipe.");
    }

    const parsed = staffPaymentSchema
      .pick({ staff_id: true, payment_date: true })
      .safeParse({ staff_id: staffId, payment_date: paymentDate });
    if (!parsed.success) {
      return failure(parsed.error.issues[0]?.message ?? "Dados inválidos.");
    }

    const supabase = createAdminClient();
    const { error } = await supabase
      .from("staff_payments")
      .delete()
      .eq("staff_id", parsed.data.staff_id)
      .eq("payment_date", parsed.data.payment_date);
    if (error) throw new Error(error.message);

    revalidateClosing();
    return { ok: true, data: null };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(
      error instanceof Error
        ? error.message
        : "Não foi possível remover o pagamento.",
    );
  }
}
