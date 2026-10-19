import {
  getAppSettings,
  listPendingInvites,
  listTeam,
  requireAdmin,
} from "@/lib/dal";
import { ConfigView } from "@/components/admin/config/config-view";

export const metadata = { title: "Configuração" };

export default async function ConfiguracaoPage() {
  const { user, profile } = await requireAdmin();
  const canEdit = profile.role === "owner";

  const { settings, ready } = await getAppSettings();
  const team = canEdit ? await listTeam().catch(() => null) : null;

  // Convites pendentes trazem o token cru (vira link de acesso ao painel do
  // cliente): só o dono lista. Sem isso, staff/viewer pegariam acesso.
  const invites = canEdit ? await listPendingInvites().catch(() => []) : [];

  return (
    <ConfigView
      selfId={user.id}
      canEdit={canEdit}
      ready={ready}
      settings={settings}
      team={team}
      invites={invites}
    />
  );
}
