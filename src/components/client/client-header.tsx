"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useState } from "react";
import { toast } from "sonner";
import {
  Bell,
  Gift,
  History,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Sun,
  UserRound,
} from "lucide-react";

import { customerSignOut } from "@/app/actions/auth";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/app/actions/notifications";
import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CustomerNotification } from "@/lib/notifications";
import { formatBRL } from "@/lib/lots";
import { cn } from "@/lib/utils";

type Props = {
  name: string | null;
  phone: string;
  notifications: CustomerNotification[];
  unreadCount: number;
  paidTotal: number;
  paidFreightTotal: number;
  paidPixTotal: number;
  openAmount: number;
};

function initialsOf(name: string | null) {
  if (!name) return "?";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

/** "14:32" para hoje; "18/10" para dias anteriores. */
function formatShortTime(iso: string) {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  if (sameDay) {
    return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/**
 * Top bar do painel: total pago (incluindo frete), notificações e avatar.
 */
export function ClientHeader({
  name,
  phone,
  notifications,
  unreadCount,
  paidTotal,
  paidFreightTotal,
  paidPixTotal,
  openAmount,
}: Props) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const [markingAll, setMarkingAll] = useState(false);

  const openNotification = async (notification: CustomerNotification) => {
    if (!notification.read_at) {
      const result = await markNotificationReadAction(notification.id);
      if (!result.ok) toast.error(result.error);
    }
    if (notification.href) router.push(notification.href);
    else router.refresh();
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    const result = await markAllNotificationsReadAction();
    setMarkingAll(false);
    if (!result.ok) toast.error(result.error);
    else router.refresh();
  };

  return (
    <header className="sticky top-0 z-40 bg-background/85 pt-[env(safe-area-inset-top,0px)] backdrop-blur-xl after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-linear-to-r after:from-transparent after:via-ouro after:to-transparent after:content-['']">
      <div className="mx-auto flex h-16 w-full max-w-2xl items-center gap-3 px-4">
        <Link href="/painel" className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amarelo text-[#0a0a0a]">
            <LogoMark className="size-5" />
          </span>
          <span className="flex min-w-0 flex-col leading-none">
            <span className="truncate text-[15px] font-semibold uppercase tracking-widest">
              OCDL
            </span>
            <span className="truncate text-[10px] font-medium uppercase tracking-[0.2em] text-ouro-ink">
              Painel do Cliente
            </span>
          </span>
        </Link>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title="Total pago em lotes"
                className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1"
              >
                <span className="text-xs font-bold text-muted-foreground">R$</span>
                <span className="text-sm font-bold tracking-tight text-ouro-ink">
                  {formatBRL(paidTotal).replace("R$ ", "")}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel>Total pago em lotes</DropdownMenuLabel>
              <p className="px-3 pb-2 text-2xl font-bold text-ouro-ink">
                {formatBRL(paidTotal)}
              </p>
              <p className="px-3 pb-2 text-xs text-muted-foreground">
                Soma dos lotes com pagamento confirmado. Fretes ficam fora deste total.
              </p>
              <DropdownMenuSeparator />
              <div className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="text-muted-foreground">Fretes pagos</span>
                <span className="font-semibold">{formatBRL(paidFreightTotal)}</span>
              </div>
              <div className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="text-muted-foreground">Total pago via Pix</span>
                <span className="font-semibold">{formatBRL(paidPixTotal)}</span>
              </div>
              <DropdownMenuSeparator />
              <div className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="text-muted-foreground">Pix em aberto</span>
                <span className="font-semibold">{formatBRL(openAmount)}</span>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={
                  unreadCount > 0
                    ? `Notificações (${unreadCount} não lidas)`
                    : "Notificações"
                }
                className="relative text-muted-foreground hover:text-foreground"
              >
                <Bell className="size-5" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-amarelo px-1 text-[9px] font-bold text-[#0a0a0a]">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel>Notificações</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {notifications.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                  Nenhuma notificação ainda.
                </p>
              ) : (
                <div className="max-h-80 overflow-y-auto">
                  {notifications.map((notification) => (
                    <DropdownMenuItem
                      key={notification.id}
                      className="flex flex-col items-start gap-0.5"
                      onSelect={() => void openNotification(notification)}
                    >
                      <span
                        className={cn(
                          "flex w-full items-center gap-2",
                          !notification.read_at && "font-semibold",
                        )}
                      >
                        {!notification.read_at && (
                          <span className="size-1.5 shrink-0 rounded-full bg-amarelo" />
                        )}
                        <span className="truncate text-sm">{notification.title}</span>
                        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                          {formatShortTime(notification.created_at)}
                        </span>
                      </span>
                      {notification.body && (
                        <span className="line-clamp-2 w-full text-xs text-muted-foreground">
                          {notification.body}
                        </span>
                      )}
                    </DropdownMenuItem>
                  ))}
                </div>
              )}
              {unreadCount > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={markingAll}
                    className="justify-center text-xs"
                    onSelect={() => void markAllRead()}
                  >
                    Marcar todas como lidas
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Menu da conta"
                className="rounded-full"
              >
                <span className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  {initialsOf(name)}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="truncate">{name ?? "Cliente"}</div>
                <div className="truncate text-xs font-normal text-muted-foreground">
                  {phone}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/painel/loja">
                  <Gift />
                  Loja de pontos
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/painel/cadastro">
                  <UserRound />
                  Meus dados
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/painel/historico">
                  <History />
                  Histórico
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Palette />
                  Tema
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => setTheme("light")}>
                    <Sun />
                    Claro
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTheme("dark")}>
                    <Moon />
                    Escuro
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTheme("system")}>
                    <Monitor />
                    Sistema
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void customerSignOut()}>
                <LogOut />
                Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
