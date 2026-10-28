"use server";

import { revalidatePath, updateTag } from "next/cache";

import { requireAdmin } from "@/lib/dal";
import { isChargeActive, type ChargeStatus } from "@/lib/charges";
import { spToday } from "@/lib/dates";
import { resolveAuctionPeriod, type AuctionPeriodInput } from "@/lib/auction-period";
import { rethrowIfRedirect, type ActionResult } from "@/lib/result";
import {
  parseMoney,
  staffPaymentSchema,
  type ClosingData,
  type ClosingEntry,
  type ClosingPendingLot,
  type ClosingPendingCharge,
} from "@/lib/staff-payments";
import { createAdminClient } from "@/lib/supabase/admin";

const failure = (error: string): ActionResult<never> => ({ ok: false, error });

const PENDING_LOTS_PAGE_SIZE = 1000;

function revalidateClosing() {
  updateTag("dashboard");
  revalidatePath("/admin/dashboard");
}

/** Relatório dos lotes cadastrados no período. Não registra pagamentos da equipe. */
export async function getClosingDataAction(
  asOf?: string,
  input: AuctionPeriodInput = {},
): Promise<ActionResult<ClosingData>> {
  try {
    const { profile } = await requireAdmin();
    if (profile.role !== "owner") return failure("Apenas o dono acessa o fechamento.");
    const period = resolveAuctionPeriod(asOf, input);
    const db = createAdminClient();
    const entries: ClosingEntry[] = [];
    for (let offset = 0; ; offset += PENDING_LOTS_PAGE_SIZE) {
      const { data, error } = await db.from("lots")
        .select("id, code, title, arremate_value, status, created_at, paid_at, customer:customers(name)")
        .neq("status", "cancelled")
        .gte("created_at", period.startUtc).lt("created_at", period.endUtc)
        .order("created_at", { ascending: true }).order("id", { ascending: true })
        .range(offset, offset + PENDING_LOTS_PAGE_SIZE - 1);
      if (error) throw new Error("Não foi possível carregar os lotes do período.");
      const page = (data ?? []) as unknown as {
        code: string; title: string; arremate_value: number | string; status: string;
        created_at: string; paid_at: string | null; customer: { name: string | null } | null;
      }[];
      entries.push(...page.map(lot => ({
        code: lot.code, title: lot.title, customer: lot.customer?.name?.trim() || "Sem nome",
        value: Number(lot.arremate_value), status: lot.status, createdAt: lot.created_at,
        paidAt: lot.paid_at,
      })));
      if (page.length < PENDING_LOTS_PAGE_SIZE) break;
    }
    // Mantém o resumo de todas as pendências, independentemente do leilão.
    const pendingLots: ClosingPendingLot[] = [];
    for (let offset = 0; ; offset += PENDING_LOTS_PAGE_SIZE) {
      const { data, error } = await db.from("lots")
        .select("code, title, arremate_value, customer:customers(name)")
        .eq("status", "pending_payment")
        .order("created_at", { ascending: false }).order("id", { ascending: false })
        .range(offset, offset + PENDING_LOTS_PAGE_SIZE - 1);
      if (error) throw new Error("Não foi possível carregar as pendências.");
      const page = (data ?? []) as unknown as {
        code: string; title: string; arremate_value: number | string;
        customer: { name: string | null } | null;
      }[];
      pendingLots.push(...page.map(lot => ({
        code: lot.code, title: lot.title, customerName: lot.customer?.name?.trim() || "Sem nome",
        amount: Number(lot.arremate_value),
      })));
      if (page.length < PENDING_LOTS_PAGE_SIZE) break;
    }
    const pendingCharges: ClosingPendingCharge[] = [];
    const now = new Date();
    for (let offset = 0; ; offset += PENDING_LOTS_PAGE_SIZE) {
      const { data, error } = await db.from("charges")
        .select("id, code, amount, status, expires_at, ticket_url, customer:customers(name, phone_e164)")
        .in("status", ["pending", "in_process"])
        .order("created_at", { ascending: false }).order("id", { ascending: false })
        .range(offset, offset + PENDING_LOTS_PAGE_SIZE - 1);
      if (error) throw new Error("Não foi possível carregar as cobranças abertas.");
      const page = (data ?? []) as unknown as {
        id: string; code: string; amount: number | string; status: ChargeStatus;
        expires_at: string | null; ticket_url: string | null;
        customer: { name: string | null; phone_e164: string } | null;
      }[];
      pendingCharges.push(...page.filter(charge => isChargeActive(charge, now)).map(charge => ({
        id: charge.id, code: charge.code, amount: Number(charge.amount),
        customerName: charge.customer?.name?.trim() || null,
        phone_e164: charge.customer?.phone_e164 ?? "", ticketUrl: charge.ticket_url,
        expiresAt: charge.expires_at,
      })));
      if (page.length < PENDING_LOTS_PAGE_SIZE) break;
    }
    const paid = entries.filter(entry => ["paid", "shipped", "delivered"].includes(entry.status) && entry.paidAt);
    const pending = entries.filter(entry => entry.status === "pending_payment");
    return { ok: true, data: {
      date: period.day, period, entries, pendingLots, pendingCharges,
      pendingTotal: pendingCharges.reduce((sum, charge) => sum + charge.amount, 0),
      registeredOn: entries.reduce((sum, entry) => sum + entry.value, 0),
      totalLots: entries.length,
      receivedOn: paid.reduce((sum, entry) => sum + entry.value, 0),
      paidLotsOn: paid.length,
      periodPendingTotal: pending.reduce((sum, entry) => sum + entry.value, 0),
      periodPendingCount: pending.length,
    } };
  } catch (error) {
    rethrowIfRedirect(error);
    return failure(error instanceof Error ? error.message : "Não foi possível carregar o fechamento.");
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
