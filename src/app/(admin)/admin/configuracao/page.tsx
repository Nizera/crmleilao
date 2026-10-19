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
  key: string | undefined,
  detail: (key: string) => string,
): IntegrationInfo {
  return {
    name,
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

  const integrations: IntegrationInfo[] = [
    integrationStatus("Mercado Pago (Pix)", mpKey, () => {
      const test = mpKey?.trim().startsWith("TEST-");
      const webhook = canEdit ? mpWebhookUrl() : null;
      return `${test ? "token de teste" : "token de produção"}${
        webhook
          ? ` — ${webhook}`
          : canEdit
            ? " — sem MP_WEBHOOK_TOKEN (confirmação manual)"
            : " — URL do webhook visível apenas ao dono"
      }`;
    }),
    {
      name: "Webhook do Mercado Pago",
      configured: Boolean(mpWebhookToken && mpWebhookSecret),
      detail: !mpWebhookToken
        ? "falta MP_WEBHOOK_TOKEN: a URL devolve 503 e nenhuma notificação é aceita"
        : !mpWebhookSecret
          ? "falta MP_WEBHOOK_SECRET: notificações aceitas sem validar a assinatura x-signature"
          : "token de path e assinatura x-signature configurados",
    },
    integrationStatus("SuperFrete (fretes)", superfreteToken, () =>
      process.env.SUPERFRETE_SANDBOX === "false"
        ? "token em produção"
        : "token em sandbox (testes)",
    ),
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
