import "server-only";

import { LANDING_GROUP_URL } from "@/lib/landing-content";
import { createAdminClient } from "@/lib/supabase/admin";

export async function sendAuctionInviteEmail(id: string) {
  const db = createAdminClient();
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.AUCTION_INVITE_EMAIL_FROM;
  const attemptedAt = new Date().toISOString();
  const stale = new Date(Date.now() - 60_000).toISOString();
  const configured = Boolean(apiKey && from);
  const { data, error } = await db.from("auction_preregistrations")
    .update({ email_status: configured ? "sending" : "unconfigured", email_attempted_at: attemptedAt })
    .eq("id", id).not("email", "is", null)
    .or(`email_status.in.(pending,failed,unconfigured),and(email_status.eq.sending,email_attempted_at.lt.${stale})`)
    .select("email").maybeSingle();
  if (error) return false;
  if (!data || !configured) return false;
  let accepted = false;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `auction-invite/${id}`,
      },
      body: JSON.stringify({
        from, to: [data.email],
        subject: "Seu convite para o grupo dos Caras das Legends",
        text: `Abra o convite e toque em Solicitar entrada no WhatsApp.\n\n${LANDING_GROUP_URL}`,
        html: `<h1>Os Caras das Legends</h1><p>Seu convite para o grupo do leilão está pronto. No WhatsApp, toque em <strong>Solicitar entrada</strong>.</p><p><a href="${LANDING_GROUP_URL.replaceAll("&", "&amp;")}">Abrir convite no WhatsApp</a></p>`,
      }),
      signal: AbortSignal.timeout(5000),
    });
    accepted = response.ok;
  } catch {
    console.warn("[auction-invite] Serviço de e-mail indisponível.");
  }
  const saved = await db.from("auction_preregistrations")
    .update({ email_status: accepted ? "accepted" : "failed" })
    .eq("id", id).eq("email_attempted_at", attemptedAt);
  return accepted && !saved.error;
}
