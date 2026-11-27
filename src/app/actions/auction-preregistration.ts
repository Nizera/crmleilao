"use server";

import { after } from "next/server";
import { z } from "zod";
import { LANDING_GROUP_URL } from "@/lib/landing-content";
import { allowPublic } from "@/lib/ratelimit";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendAuctionInviteEmail } from "@/lib/auction-invite-email";

const schema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().max(32).regex(/^\+?[\d\s().-]+$/),
  email: z.string().trim().pipe(z.email().max(254)),
  attribution: z.object({
    utm_source: z.string().max(160).optional(),
    utm_medium: z.string().max(160).optional(),
    utm_campaign: z.string().max(160).optional(),
    utm_content: z.string().max(160).optional(),
    utm_term: z.string().max(160).optional(),
  }),
});

export async function saveAuctionPreregistration(input: unknown) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Confira seu nome, WhatsApp e e-mail." } as const;
  const { name, phone, email, attribution } = parsed.data;
  const digits = phone.replace(/\D/g, "");
  const national = digits.length > 11 && digits.startsWith("55") ? digits.slice(2) : digits;
  if (!/^[1-9]\d(?:9\d{8}|[2-5]\d{7})$/.test(national)) {
    return { ok: false, error: "Informe seu WhatsApp com DDD." } as const;
  }
  const phoneE164 = `+55${national}`;
  if (!await allowPublic("auction-preregistration", phoneE164)) {
    return { ok: false, error: "Aguarde alguns minutos e tente novamente." } as const;
  }
  const db = createAdminClient();
  const { data, error } = await db.from("auction_preregistrations")
    .upsert({ name, phone_e164: phoneE164, email, attribution }, {
      onConflict: "phone_e164", ignoreDuplicates: true,
    }).select("id").maybeSingle();
  if (error) return { ok: false, error: "Não foi possível salvar agora. Tente novamente." } as const;

  let inviteLead = data;
  if (!inviteLead) {
    // Preserve the original registration and fill an empty email only once.
    const updated = await db.from("auction_preregistrations").update({ email, email_status: "pending" })
      .eq("phone_e164", phoneE164).is("email", null).select("id").maybeSingle();
    if (updated.error) return { ok: false, error: "Não foi possível salvar agora. Tente novamente." } as const;
    inviteLead = updated.data;
  }
  if (inviteLead) {
    const { id } = inviteLead;
    after(async () => { await sendAuctionInviteEmail(id); });
  }
  return { ok: true, leadId: data?.id ?? null, invite: LANDING_GROUP_URL } as const;
}
