import { getAppSettings, listTeam, requireAdmin } from "@/lib/dal";
import {
  ConfigView,
  type IntegrationInfo,
} from "@/components/admin/config/config-view";

export const metadata = { title: "Configuração" };

function integrationStatus(
  name: string,
  phase: string,
  key: string | undefined,
  detail: (key: string) => string,
): IntegrationInfo {
  return {
    name,
    phase,
    configured: key ? true : false,
    detail: key ? detail(key) : "chave não configurada no .env.local",
  };
}

export default async function ConfiguracaoPage() {
  const { user, profile } = await requireAdmin();
  const canEdit = profile.role === "owner";

  const { settings, ready } = await getAppSettings();
  const team = canEdit ? await listTeam().catch(() => null) : null;

  const mpKey = process.env.MP_ACCESS_TOKEN;
  const superfreteToken = process.env.SUPERFRETE_TOKEN;
  const whatsappToken = process.env.WHATSAPP_TOKEN;

  const integrations: IntegrationInfo[] = [
    integrationStatus("Mercado Pago (Pix)", "Fase 3", mpKey, () => {
      const test = mpKey?.trim().startsWith("TEST-");
      const webhook = process.env.MP_WEBHOOK_TOKEN?.trim();
      return `${test ? "token de teste" : "token de produção"}${
        webhook ? " + webhook ok" : " — sem MP_WEBHOOK_TOKEN (confirmação manual)"
      }`;
    }),
    integrationStatus("SuperFrete (fretes)", "Fase 4", superfreteToken, () =>
      process.env.SUPERFRETE_SANDBOX === "false"
        ? "token em produção"
        : "token em sandbox (testes)",
    ),
    integrationStatus(
      "WhatsApp Cloud API",
      "Opcional",
      whatsappToken,
      () => "envio de mídia pelo Meta",
    ),
    {
      name: "Login por OTP no WhatsApp",
      phase: "Login do cliente",
      configured: null,
      detail: "Supabase → Authentication → Providers → Phone (Twilio Verify)",
    },
    {
      name: "Gemini",
      phase: "Descartado",
      configured: false,
      detail: "não usado: catálogo fixo de 80 SKUs",
    },
  ];

  return (
    <ConfigView
      selfId={user.id}
      canEdit={canEdit}
      ready={ready}
      settings={settings}
      team={team}
      integrations={integrations}
    />
  );
}
