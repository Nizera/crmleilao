/** Papéis da equipe que acessa /admin. Um só vocabulário para cliente e servidor. */
export type AdminRole = "owner" | "staff" | "viewer";

export const ADMIN_ROLES: AdminRole[] = ["owner", "staff", "viewer"];

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  owner: "Dono",
  staff: "Equipe",
  viewer: "Somente leitura",
};

export const ADMIN_ROLE_HINTS: Record<AdminRole, string> = {
  owner: "Acesso total, inclui configuração e equipe.",
  staff: "Opera lotes, clientes, estoque e mensagens.",
  viewer: "Só consulta; nenhuma alteração é permitida.",
};

export function parseAdminRole(value: string): AdminRole | null {
  return ADMIN_ROLES.includes(value as AdminRole) ? (value as AdminRole) : null;
}
