import {
  getAppSettings,
  listPendingInvites,
  listTeam,
  requireAdmin,
} from "@/lib/dal";
import { mpWebhookUrl } from "@/lib/mercadopago";
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

  // Convites pendentes trazem o token cru (vira link de acesso ao painel do
  // cliente): só o dono lista. Sem isso, staff/viewer pegariam acesso.
  const invites = canEdit ? await listPendingInvites().catch(() => []) : [];

  const mpKey = process.env.MP_ACCESS_TOKEN;
  const mpWebhookToken = process.env.MP_WEBHOOK_TOKEN?.trim();
  const mpWebhookSecret = process.env.MP_WEBHOOK_SECRET?.trim();
  const superfreteToken = process.env.SUPERFRETE_TOKEN;
  const whatsappToken = process.env.WHATSAPP_TOKEN;

  const integrations: IntegrationInfo[] = [
    integrationStatus("Mercado Pago (Pix)", "Fase 3", mpKey, () => {
      const test = mpKey?.trim().startsWith("TEST-");
      const webhook = canEdit ? mpWebhookUrl() : null;
      return `${test ? "token de teste" : "token de produção"}${
        webhook
          ? ` — cadastre a URL em Suas integrações → Webhooks (evento Order): ${webhook}`
          : canEdit
            ? " — sem MP_WEBHOOK_TOKEN (confirmação manual)"
            : " — URL do webhook visível apenas ao dono"
      }`;
    }),
    {
      name: "Webhook do Mercado Pago",
      phase: "Segurança",
      configured: Boolean(mpWebhookToken && mpWebhookSecret),
      detail: !mpWebhookToken
        ? "sem MP_WEBHOOK_TOKEN: a URL do webhook devolve 503 e nenhuma notificação é aceita"
        : !mpWebhookSecret
          ? "sem MP_WEBHOOK_SECRET: as notificações são aceitas sem validar a assinatura x-signature — configure para fechar o endpoint"
          : "token de path e assinatura x-signature configurados",
    },
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
      invites={invites}
    />
  );
}
