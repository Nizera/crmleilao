import { connection } from "next/server";
import { requireAdmin } from "@/lib/dal";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminHeader } from "@/components/admin/admin-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

// Rotas autenticadas leem cookies() na request e não entram no shell estático.
export const instant = false;

export default async function AdminLayout({
  children,
}: LayoutProps<"/admin">) {
  // Segue request-time: a sessão é por usuário e não pode ser pré-renderizada.
  await connection();

  const { profile } = await requireAdmin();

  return (
    <SidebarProvider>
      <AdminSidebar />
      <SidebarInset>
        <AdminHeader
          name={profile.name ?? "Equipe"}
          role={profile.role}
        />
        <div className="flex flex-1 flex-col">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
