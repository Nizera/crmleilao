import "server-only";

import { LANDING_GROUP_URL } from "@/lib/landing-content";
import { createAdminClient } from "@/lib/supabase/admin";

function renderAuctionInvite() {
  const invite = LANDING_GROUP_URL.replaceAll("&", "&amp;");
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Seu convite para o leilão</title>
</head>
<body style="margin:0;padding:0;background:#efede8;font-family:Arial,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all">Abra o convite e solicite sua entrada no grupo pelo WhatsApp.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#efede8">
    <tr><td align="center" style="padding:24px 12px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#181612;border:1px solid #3b3120;border-radius:18px">
        <tr><td align="center" style="padding:28px 24px 20px;border-bottom:1px solid #40351e">
          <img src="https://www.oscarasdaslegends.com.br/brand/mark.png" width="64" height="70" alt="" style="display:block;margin:0 auto 10px;border:0">
          <p style="margin:0;color:#f5cb59;font-size:12px;line-height:18px;font-weight:bold;letter-spacing:2px;text-transform:uppercase">Os Caras das Legends</p>
        </td></tr>
        <tr><td style="padding:28px 26px 30px;color:#fdf8eb">
          <h1 style="margin:0 0 12px;max-width:400px;font-size:32px;line-height:38px;letter-spacing:-.5px">Seu convite para o grupo do leilão chegou!</h1>
          <p style="margin:0 0 24px;color:#ded4bf;font-size:16px;line-height:25px">Entre no grupo para acompanhar os lotes de Legends e dar seus lances.</p>
          <table role="presentation" cellspacing="0" cellpadding="0">
            <tr><td bgcolor="#ffd323" style="border-radius:10px">
              <a href="${invite}" style="display:inline-block;padding:15px 20px;border:1px solid #ffd323;border-radius:10px;color:#18140b;font-size:16px;line-height:20px;font-weight:bold;text-decoration:none">Abrir convite no WhatsApp</a>
            </td></tr>
          </table>
          <p style="margin:16px 0 0;color:#ded4bf;font-size:14px;line-height:22px">No WhatsApp, toque em <strong style="color:#fdf8eb">Solicitar entrada</strong> e aguarde a aprovação da equipe.</p>
        </td></tr>
      </table>
      <p style="margin:16px 0 0;color:#60584c;font-size:12px;line-height:18px">Você recebeu este e-mail após o pré-cadastro para o grupo do leilão.</p>
    </td></tr>
  </table>
</body>
</html>`;
}

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
        text: `Os Caras das Legends\n\nSeu convite para o grupo do leilão chegou!\n\nAbra o convite no WhatsApp, toque em Solicitar entrada e aguarde a aprovação da equipe.\n\n${LANDING_GROUP_URL}`,
        html: renderAuctionInvite(),
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
